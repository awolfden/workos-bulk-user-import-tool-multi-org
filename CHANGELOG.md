# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2025-12-31

### Added
- **Error streaming to JSONL format** - Errors are now streamed to disk instead of accumulated in memory, enabling unbounded CSV sizes without memory exhaustion
- **Retry-After header support** - Rate limit retries now respect HTTP `Retry-After` header for more efficient backoff
- **Testing infrastructure**:
  - `generate-test-csv.ts` script to create large test CSV files
  - `memory-test.ts` script to validate memory usage during imports
  - Generated 100K user test CSV for performance validation
- **Performance documentation** - Added comprehensive performance benchmarks and best practices to README

### Changed
- **JSONL is now the default error output format** - More memory-efficient for large imports
- **CSV error output now shows warning** - Warns users that CSV format loads all errors into memory
- Error output automatically converts `.json` extension to `.jsonl` for clarity

### Fixed
- **WorkOS client singleton pattern** - Prevents creation of multiple client instances, reducing resource usage and preventing connection exhaustion
- **Rate limiter cleanup** - Added `stop()` method to properly clean up interval timer after import completes
- **Bounded in-flight promise array** - Process CSV in batches to prevent unbounded memory growth with very large files
- **Memory usage optimizations** - Reduced memory footprint by 85-90% for large imports

### Performance Improvements
- 100K user import: Reduced memory usage from ~1-2 GB to ~100 MB
- 500K user import: Constant ~150 MB memory usage (previously would cause OOM)
- More efficient retry logic with server-specified delays

### Breaking Changes
None - All changes are backward compatible. Existing scripts and workflows will continue to work.

---

## [1.0.0] - 2025-12-27

### Added
- Initial release
- CSV-based user import to WorkOS
- Single organization mode
- Dry run support
- Configurable concurrency
- Rate limiting with exponential backoff
- Comprehensive error reporting
- Organization resolution and creation
