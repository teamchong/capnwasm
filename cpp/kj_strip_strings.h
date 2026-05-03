// Forced-include header that overrides KJ assertion macros to drop both
// the stringified-condition text AND the caller-supplied descriptive
// `__VA_ARGS__` strings. Saves a few KB from the wasm bundle in exchange
// for opaque error messages.
//
// What still works: the assertion fires, an exception is thrown, the file
// name and line number are preserved (those are tiny; one filename per
// .c++ translation unit, deduplicated across all sites in that file).
// What's lost: the textual representation of the failed condition (e.g.
// `"ref->kind() == WirePointer::STRUCT"`) and any descriptive text the
// caller passed via the macro varargs (e.g. `"requested object size
// exceeds maximum segment size"`).
//
// Used via `-include cpp/kj_strip_strings.h` in cpp/build.sh.

#pragma once

#include <kj/debug.h>

#undef KJ_REQUIRE
#define KJ_REQUIRE(cond, ...) \
  if (auto _kjCondition = ::kj::_::MAGIC_ASSERT << cond) {} else \
    for (::kj::_::Debug::Fault f(__FILE__, __LINE__, ::kj::Exception::Type::FAILED, \
        nullptr, nullptr, _kjCondition);; f.fatal())

#undef KJ_REQUIRE_AT
#define KJ_REQUIRE_AT(cond, location, ...) \
  if (auto _kjCondition = ::kj::_::MAGIC_ASSERT << cond) {} else \
    for (::kj::_::Debug::Fault f(location.fileName, location.lineNumber, \
        ::kj::Exception::Type::FAILED, nullptr, nullptr, _kjCondition);; f.fatal())

#undef KJ_FAIL_REQUIRE
#define KJ_FAIL_REQUIRE(...) \
  for (::kj::_::Debug::Fault f(__FILE__, __LINE__, ::kj::Exception::Type::FAILED, \
                               nullptr, nullptr);; f.fatal())

#undef KJ_FAIL_REQUIRE_AT
#define KJ_FAIL_REQUIRE_AT(location, ...) \
  for (::kj::_::Debug::Fault f(location.fileName, location.lineNumber, \
                               ::kj::Exception::Type::FAILED, nullptr, nullptr);; f.fatal())

#undef KJ_ASSERT
#define KJ_ASSERT(cond, ...) \
  if (auto _kjCondition = ::kj::_::MAGIC_ASSERT << cond) {} else \
    for (::kj::_::Debug::Fault f(__FILE__, __LINE__, ::kj::Exception::Type::FAILED, \
        nullptr, nullptr, _kjCondition);; f.fatal())

#undef KJ_FAIL_ASSERT
#define KJ_FAIL_ASSERT(...) \
  for (::kj::_::Debug::Fault f(__FILE__, __LINE__, ::kj::Exception::Type::FAILED, \
                               nullptr, nullptr);; f.fatal())

// KJ_LOG / KJ_DBG are debugging output paths that go through formatted
// logging; they pull in kj::str() formatters, the Debug::log severity
// filter, and (transitively, via kj's sysstr) the wasi-libc strerror
// table. None of this is callable from JS in our environment; log
// messages have nowhere to go (no stderr) even if reached. Replacing
// the macros with no-ops lets --gc-sections drop ~1.5 KB of errno-name
// table and the surrounding format machinery.
#undef KJ_LOG
#define KJ_LOG(severity, ...) ((void)0)
#undef KJ_LOG_AT
#define KJ_LOG_AT(severity, location, ...) ((void)0)
#undef KJ_DBG
#define KJ_DBG(...) ((void)0)

// trimSourceFilename runtime path canonicalization is unnecessary once
// -ffile-prefix-map=cpp/vendor/= has already stripped the build prefix
// from `__FILE__` strings; paths arrive as "kj/mutex.c++" which match
// none of trimSourceFilename's hardcoded ROOTS ("ekam-provider/...",
// "src/", "tmp/") so the function would just return its input anyway.
// build.sh sed-patches the body of trimSourceFilename to a single
// `return filename;` line at compile time; see TRIM_SOURCE_FILENAME
// section there. The result drops the ROOTS string table and the loop.
