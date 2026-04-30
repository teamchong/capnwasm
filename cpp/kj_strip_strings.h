// Forced-include header that overrides KJ assertion macros to drop the
// stringified condition and macro-arg text. Stripping these saves a few KB
// from the wasm bundle in exchange for less specific error messages.
//
// What still works: the assertion fires, an exception is thrown, the file
// name and line number are preserved (those are tiny — one filename per .c++
// translation unit, deduplicated across all sites in that file).
// What's lost: the textual representation of the failed condition (e.g.
// `"ref->kind() == WirePointer::STRUCT"`) and any descriptive text the
// caller passed via the macro varargs.
//
// Used via `-include cpp/kj_strip_strings.h` in cpp/build.sh.

#pragma once

#include <kj/debug.h>

#undef KJ_REQUIRE
#define KJ_REQUIRE(cond, ...) \
  if (auto _kjCondition = ::kj::_::MAGIC_ASSERT << cond) {} else \
    for (::kj::_::Debug::Fault f(__FILE__, __LINE__, ::kj::Exception::Type::FAILED, \
        nullptr, nullptr, _kjCondition, ##__VA_ARGS__);; f.fatal())

#undef KJ_REQUIRE_AT
#define KJ_REQUIRE_AT(cond, location, ...) \
  if (auto _kjCondition = ::kj::_::MAGIC_ASSERT << cond) {} else \
    for (::kj::_::Debug::Fault f(location.fileName, location.lineNumber, \
        ::kj::Exception::Type::FAILED, nullptr, nullptr, _kjCondition, \
        ##__VA_ARGS__);; f.fatal())

#undef KJ_FAIL_REQUIRE
#define KJ_FAIL_REQUIRE(...) \
  for (::kj::_::Debug::Fault f(__FILE__, __LINE__, ::kj::Exception::Type::FAILED, \
                               nullptr, nullptr, ##__VA_ARGS__);; f.fatal())

#undef KJ_FAIL_REQUIRE_AT
#define KJ_FAIL_REQUIRE_AT(location, ...) \
  for (::kj::_::Debug::Fault f(location.fileName, location.lineNumber, \
                               ::kj::Exception::Type::FAILED, nullptr, nullptr, \
                               ##__VA_ARGS__);; f.fatal())

#undef KJ_ASSERT
#define KJ_ASSERT(cond, ...) \
  if (auto _kjCondition = ::kj::_::MAGIC_ASSERT << cond) {} else \
    for (::kj::_::Debug::Fault f(__FILE__, __LINE__, ::kj::Exception::Type::FAILED, \
        nullptr, nullptr, _kjCondition, ##__VA_ARGS__);; f.fatal())

#undef KJ_FAIL_ASSERT
#define KJ_FAIL_ASSERT(...) \
  for (::kj::_::Debug::Fault f(__FILE__, __LINE__, ::kj::Exception::Type::FAILED, \
                               nullptr, nullptr, ##__VA_ARGS__);; f.fatal())
