;; Experimental WasmGC decode path.
;;
;; Reads a tape (the same byte format as src/tape.zig produces) from shared
;; memory and constructs a capnweb-shape JS value tree by calling JS-side
;; constructors via externref imports. The result is the materialized JS root.
;;
;; This trades the bulk JS-side TapeReader walk for a wasm-driven series of
;; externref import calls. Hypothesis: V8's externref boundary is cheaper than
;; the JS-side recursive walk for object/array-heavy payloads.
;;
;; Tape grammar (kept in sync with src/tape.zig):
;;   msg_tag = u8 in 0..7 (push|pull|resolve|reject|release|stream|abort|pipe)
;;   expr_tag = u8 (see src/tape.zig comment header for full table)
;;
;; Memory: imported from the host. JS writes the tape into a known offset
;; before calling decode_root.

(module $cw_gc

  ;; --- Imports -------------------------------------------------------------
  (import "env" "memory" (memory 1))

  ;; JS-side constructors. Each returns the constructed value as an externref.
  (import "js" "make_array" (func $make_array (result externref)))
  (import "js" "array_push" (func $array_push (param externref externref)))
  (import "js" "make_object" (func $make_object (result externref)))
  ;; set_field(obj, key_str, value)
  (import "js" "set_field" (func $set_field (param externref externref externref)))
  ;; make_string(ptr, len) reads UTF-8 from shared memory
  (import "js" "make_string" (func $make_string (param i32 i32) (result externref)))
  (import "js" "make_int_safe" (func $make_int_safe (param i32 i32) (result externref)))
  (import "js" "make_double" (func $make_double (param f64) (result externref)))
  (import "js" "make_undefined" (func $make_undefined (result externref)))
  (import "js" "make_null" (func $make_null (result externref)))
  (import "js" "make_true" (func $make_true (result externref)))
  (import "js" "make_false" (func $make_false (result externref)))
  (import "js" "make_data" (func $make_data (param i32 i32) (result externref)))
  (import "js" "make_date" (func $make_date (param f64) (result externref)))
  (import "js" "make_bigint_text" (func $make_bigint_text (param i32 i32) (result externref)))
  ;; Dedicated tagged-form constructors (return ["import", id], etc.)
  (import "js" "make_import_ref" (func $make_import_ref (param i32 i32) (result externref)))
  (import "js" "make_export_ref" (func $make_export_ref (param i32 i32) (result externref)))
  (import "js" "make_pipeline" (func $make_pipeline
    (param externref externref) (result externref))) ;; (source, path_array)
  (import "js" "make_pipeline_with_args" (func $make_pipeline_with_args
    (param externref externref externref) (result externref))) ;; (source, path_array, args)
  (import "js" "make_error" (func $make_error (param externref externref) (result externref)))
  (import "js" "make_message" (func $make_message
    (param i32 externref externref) (result externref))) ;; (msg_tag_byte, arg1?, arg2?)

  ;; --- Tape cursor ---------------------------------------------------------
  (global $cursor (mut i32) (i32.const 0))
  (global $end (mut i32) (i32.const 0))

  (func $read_u8 (result i32)
    (local $v i32)
    (local.set $v (i32.load8_u (global.get $cursor)))
    (global.set $cursor (i32.add (global.get $cursor) (i32.const 1)))
    (local.get $v))

  (func $read_u32 (result i32)
    (local $v i32)
    (local.set $v (i32.load (global.get $cursor)))
    (global.set $cursor (i32.add (global.get $cursor) (i32.const 4)))
    (local.get $v))

  (func $read_i64_lo (result i32)
    (i32.load (global.get $cursor)))

  (func $read_i64_hi (result i32)
    (i32.load (i32.add (global.get $cursor) (i32.const 4))))

  (func $advance_8
    (global.set $cursor (i32.add (global.get $cursor) (i32.const 8))))

  (func $read_f64 (result f64)
    (local $v f64)
    (local.set $v (f64.load (global.get $cursor)))
    (global.set $cursor (i32.add (global.get $cursor) (i32.const 8)))
    (local.get $v))

  ;; --- Read an expression as externref ------------------------------------
  (func $read_expr (result externref)
    (local $tag i32)
    (local $len i32)
    (local $start i32)
    (local $count i32)
    (local $i i32)
    (local $arr externref)
    (local $obj externref)
    (local $src externref)
    (local $path externref)
    (local $args externref)
    (local $key externref)
    (local $val externref)

    (local.set $tag (call $read_u8))

    ;; null = 0x00
    (if (i32.eq (local.get $tag) (i32.const 0x00))
      (then (return (call $make_null))))
    ;; true = 0x01
    (if (i32.eq (local.get $tag) (i32.const 0x01))
      (then (return (call $make_true))))
    ;; false = 0x02
    (if (i32.eq (local.get $tag) (i32.const 0x02))
      (then (return (call $make_false))))
    ;; int = 0x03  (i64 → safe-integer JS number via two i32)
    (if (i32.eq (local.get $tag) (i32.const 0x03))
      (then
        (local.set $val (call $make_int_safe (call $read_i64_lo) (call $read_i64_hi)))
        (call $advance_8)
        (return (local.get $val))))
    ;; float = 0x04
    (if (i32.eq (local.get $tag) (i32.const 0x04))
      (then (return (call $make_double (call $read_f64)))))
    ;; text = 0x05
    (if (i32.eq (local.get $tag) (i32.const 0x05))
      (then
        (local.set $len (call $read_u32))
        (local.set $start (global.get $cursor))
        (global.set $cursor (i32.add (local.get $start) (local.get $len)))
        (return (call $make_string (local.get $start) (local.get $len)))))
    ;; data = 0x06
    (if (i32.eq (local.get $tag) (i32.const 0x06))
      (then
        (local.set $len (call $read_u32))
        (local.set $start (global.get $cursor))
        (global.set $cursor (i32.add (local.get $start) (local.get $len)))
        (return (call $make_data (local.get $start) (local.get $len)))))
    ;; date = 0x07
    (if (i32.eq (local.get $tag) (i32.const 0x07))
      (then (return (call $make_date (call $read_f64)))))
    ;; bigint = 0x08
    (if (i32.eq (local.get $tag) (i32.const 0x08))
      (then
        (local.set $len (call $read_u32))
        (local.set $start (global.get $cursor))
        (global.set $cursor (i32.add (local.get $start) (local.get $len)))
        (return (call $make_bigint_text (local.get $start) (local.get $len)))))
    ;; undefined = 0x09
    (if (i32.eq (local.get $tag) (i32.const 0x09))
      (then (return (call $make_undefined))))
    ;; array = 0x10
    (if (i32.eq (local.get $tag) (i32.const 0x10))
      (then
        (local.set $count (call $read_u32))
        (local.set $arr (call $make_array))
        (local.set $i (i32.const 0))
        (block $arr_done
          (loop $arr_loop
            (br_if $arr_done (i32.ge_u (local.get $i) (local.get $count)))
            (call $array_push (local.get $arr) (call $read_expr))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $arr_loop)))
        (return (local.get $arr))))
    ;; object = 0x11
    (if (i32.eq (local.get $tag) (i32.const 0x11))
      (then
        (local.set $count (call $read_u32))
        (local.set $obj (call $make_object))
        (local.set $i (i32.const 0))
        (block $obj_done
          (loop $obj_loop
            (br_if $obj_done (i32.ge_u (local.get $i) (local.get $count)))
            (local.set $len (call $read_u32))
            (local.set $start (global.get $cursor))
            (global.set $cursor (i32.add (local.get $start) (local.get $len)))
            (local.set $key (call $make_string (local.get $start) (local.get $len)))
            (local.set $val (call $read_expr))
            (call $set_field (local.get $obj) (local.get $key) (local.get $val))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $obj_loop)))
        (return (local.get $obj))))
    ;; import = 0x20  → ["import", id]
    (if (i32.eq (local.get $tag) (i32.const 0x20))
      (then
        (local.set $val (call $make_import_ref (call $read_i64_lo) (call $read_i64_hi)))
        (call $advance_8)
        (return (local.get $val))))
    ;; export = 0x21  → ["export", id]
    (if (i32.eq (local.get $tag) (i32.const 0x21))
      (then
        (local.set $val (call $make_export_ref (call $read_i64_lo) (call $read_i64_hi)))
        (call $advance_8)
        (return (local.get $val))))
    ;; pipeline = 0x22
    (if (i32.eq (local.get $tag) (i32.const 0x22))
      (then
        (local.set $src (call $read_expr))
        (local.set $count (call $read_u32))
        (local.set $path (call $make_array))
        (local.set $i (i32.const 0))
        (block $path_done
          (loop $path_loop
            (br_if $path_done (i32.ge_u (local.get $i) (local.get $count)))
            (local.set $len (call $read_u32))
            (local.set $start (global.get $cursor))
            (global.set $cursor (i32.add (local.get $start) (local.get $len)))
            (call $array_push (local.get $path) (call $make_string (local.get $start) (local.get $len)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $path_loop)))
        (if (i32.eq (call $read_u8) (i32.const 1))
          (then
            (local.set $args (call $read_expr))
            (return (call $make_pipeline_with_args (local.get $src) (local.get $path) (local.get $args)))))
        (return (call $make_pipeline (local.get $src) (local.get $path)))))
    ;; error = 0x23
    (if (i32.eq (local.get $tag) (i32.const 0x23))
      (then
        (local.set $len (call $read_u32))
        (local.set $start (global.get $cursor))
        (global.set $cursor (i32.add (local.get $start) (local.get $len)))
        (local.set $key (call $make_string (local.get $start) (local.get $len)))
        (local.set $len (call $read_u32))
        (local.set $start (global.get $cursor))
        (global.set $cursor (i32.add (local.get $start) (local.get $len)))
        (local.set $val (call $make_string (local.get $start) (local.get $len)))
        (return (call $make_error (local.get $key) (local.get $val)))))

    ;; Unknown tag — return null. JS-side decoder will spot this if needed.
    (call $make_null))

  ;; --- Read a top-level message --------------------------------------------
  (func $read_message (result externref)
    (local $tag i32)
    (local $arg1 externref)
    (local $arg2 externref)
    (local.set $tag (call $read_u8))

    ;; pull = 1: arg1 = id (as number), arg2 = null
    (if (i32.eq (local.get $tag) (i32.const 1))
      (then
        (local.set $arg1 (call $make_int_safe (call $read_i64_lo) (call $read_i64_hi)))
        (call $advance_8)
        (return (call $make_message (local.get $tag) (local.get $arg1) (call $make_null)))))
    ;; release = 4: arg1 = id, arg2 = refcount (as number)
    (if (i32.eq (local.get $tag) (i32.const 4))
      (then
        (local.set $arg1 (call $make_int_safe (call $read_i64_lo) (call $read_i64_hi)))
        (call $advance_8)
        (local.set $arg2 (call $make_int_safe (call $read_u32) (i32.const 0)))
        (return (call $make_message (local.get $tag) (local.get $arg1) (local.get $arg2)))))
    ;; resolve = 2, reject = 3: arg1 = id, arg2 = expr
    (if (i32.or
          (i32.eq (local.get $tag) (i32.const 2))
          (i32.eq (local.get $tag) (i32.const 3)))
      (then
        (local.set $arg1 (call $make_int_safe (call $read_i64_lo) (call $read_i64_hi)))
        (call $advance_8)
        (local.set $arg2 (call $read_expr))
        (return (call $make_message (local.get $tag) (local.get $arg1) (local.get $arg2)))))
    ;; pipe = 7: no args
    (if (i32.eq (local.get $tag) (i32.const 7))
      (then
        (return (call $make_message (local.get $tag) (call $make_null) (call $make_null)))))
    ;; push/stream/abort = 0/5/6: arg1 = expr, arg2 = null
    (local.set $arg1 (call $read_expr))
    (call $make_message (local.get $tag) (local.get $arg1) (call $make_null)))

  ;; Entry: read a tape from `[ptr, ptr+len)` and return the decoded root.
  (func (export "decode_root") (param $ptr i32) (param $len i32) (result externref)
    (global.set $cursor (local.get $ptr))
    (global.set $end (i32.add (local.get $ptr) (local.get $len)))
    (call $read_message))
)
