cmake_minimum_required(VERSION 3.14)
project(sermon-verse-detector VERSION 1.0.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Put binaries directly in build/ on all platforms (avoids build/Release/ on MSVC).
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY_RELEASE ${CMAKE_BINARY_DIR})
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY_DEBUG ${CMAKE_BINARY_DIR})

# ── Options ──────────────────────────────────────────────────
option(BUILD_WHISPER "Build whisper.cpp from submodule" ON)

# Build whisper as static libraries so the binary is self-contained.
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(GGML_STATIC ON CACHE BOOL "" FORCE)
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)

# ── whisper.cpp ──────────────────────────────────────────────
if(BUILD_WHISPER)
    if(NOT EXISTS "${CMAKE_SOURCE_DIR}/third_party/whisper.cpp/CMakeLists.txt")
        message(STATUS "Fetching whisper.cpp via FetchContent...")
        include(FetchContent)
        FetchContent_Declare(
            whisper
            GIT_REPOSITORY https://github.com/ggerganov/whisper.cpp.git
            GIT_TAG        master
            SOURCE_DIR     "${CMAKE_SOURCE_DIR}/third_party/whisper.cpp"
        )
        FetchContent_MakeAvailable(whisper)
    else()
        add_subdirectory(third_party/whisper.cpp)
    endif()
endif()

# ── nlohmann/json (header-only) ─────────────────────────────
if(NOT EXISTS "${CMAKE_SOURCE_DIR}/third_party/nlohmann/json.hpp")
    message(STATUS "Downloading nlohmann/json.hpp...")
    file(DOWNLOAD
        "https://github.com/nlohmann/json/releases/download/v3.11.3/json.hpp"
        "${CMAKE_SOURCE_DIR}/third_party/nlohmann/json.hpp"
        SHOW_PROGRESS
    )
endif()

# ── Find system libraries ───────────────────────────────────
set(CURL_USE_STATIC_LIBS ON)
find_package(CURL REQUIRED)

# ── Sources ──────────────────────────────────────────────────
set(SOURCES
    src/main.cpp
    src/pipeline.cpp
    src/intent_resolver.cpp
    src/cache.cpp
    src/session_state.cpp
    src/api_fetch.cpp
    src/dedup.cpp
    src/output.cpp
    src/book_normalizer.cpp
    src/context_resolver.cpp
    src/local_intent_resolver.cpp
)

# ── Executable ───────────────────────────────────────────────
add_executable(sermon-verse-detector ${SOURCES})

target_include_directories(sermon-verse-detector PRIVATE
    ${CMAKE_SOURCE_DIR}/src
    ${CMAKE_SOURCE_DIR}/third_party
    ${CURL_INCLUDE_DIRS}
)

target_link_libraries(sermon-verse-detector PRIVATE
    whisper
    CURL::libcurl
)

# ── Platform-specific ────────────────────────────────────────
if(APPLE)
    target_link_libraries(sermon-verse-detector PRIVATE
        "-framework Accelerate"
        "-framework CoreML"
        "-framework Metal"
    )
endif()

# ── Install ──────────────────────────────────────────────────
install(TARGETS sermon-verse-detector DESTINATION bin)
install(FILES config.json DESTINATION bin)
install(DIRECTORY bibles/ DESTINATION bin/bibles)
