# Contributing to ShyTalk

Thank you for your interest in contributing to ShyTalk! This guide will help you get started.

## Getting Started

1. **Fork** the repository on GitHub
2. **Clone** your fork locally
3. **Create a branch** for your changes (see naming conventions below)
4. **Implement** your changes
5. **Test** thoroughly
6. **Push** to your fork and **open a Pull Request**

## Branch Naming

Use the following prefixes for your branches:

- `feature/description` -- new features (e.g., `feature/room-search`)
- `fix/description` -- bug fixes (e.g., `fix/chat-scroll-position`)
- `docs/description` -- documentation updates
- `chore/description` -- maintenance tasks, dependency updates

## Commit Messages

We follow **conventional commits**. Each commit message should have a type prefix:

```
feat: add room search functionality
fix: resolve chat scroll position reset on new message
docs: update API environment variable table
chore: bump kotlinx-datetime to 0.7.0
refactor: extract seat management into separate ViewModel
test: add unit tests for gift sending flow
```

Keep the subject line concise (under 72 characters). Use the body for additional context when needed.

## Pull Request Process

1. **Branch from `main`** -- always create your branch from the latest `main`
2. **Keep PRs focused** -- one feature or fix per PR
3. **Run all tests** before submitting:
   ```bash
   # Kotlin/KMP unit tests
   ./gradlew test

   # Express API tests
   cd express-api && npm test
   ```
4. **Write a clear PR description** explaining what changed and why
5. **Link related issues** if applicable

## Testing Requirements

- **All new code must have tests** -- unit tests at minimum
- **Bug fixes must include a regression test** covering the fixed behavior
- **Run the full test suite** before submitting your PR -- do not rely on CI alone
- Express API routes should have corresponding test coverage

## Code Style

### Kotlin (Android/KMP)

- Follow [Kotlin coding conventions](https://kotlinlang.org/docs/coding-conventions.html)
- Use meaningful, descriptive names for variables, functions, and classes
- Keep composables focused and modular -- one responsibility per composable
- ViewModels should use unidirectional data flow with `StateFlow` and sealed UI state classes
- Follow the MVVM + Repository pattern established in the codebase
- Place shared code in `shared/src/commonMain/` -- only put platform-specific code in `androidMain`/`iosMain`
- Never use JVM-only APIs in `commonMain` (they break iOS builds)

### Express API (Node.js)

- Use structured logging via the project's logger utility (`src/utils/logger.js`)
- Follow the existing route pattern: `const router = express.Router(); module.exports = router;`
- Include proper error handling and input validation in all routes
- Add appropriate log statements at info, warn, and error levels

### General

- No unused imports or dead code
- Keep functions short and focused
- Add comments for complex business logic, but prefer self-documenting code

## Cost Constraint

ShyTalk is designed to run entirely on **free tiers** ($0 hosting cost). When contributing:

- **Do not introduce paid services** -- no Firebase Blaze plan, no paid Cloudflare plans, no external paid databases or APIs
- If your feature requires infrastructure, verify it fits within existing free tier limits (Firebase Spark, Cloudflare Free, Oracle Cloud Free Tier)
- Prefer lightweight solutions that minimize resource consumption

## KMP / iOS Compatibility

When writing code in `commonMain`, avoid JVM-specific APIs:

- Use `kotlin.math.*` instead of `java.lang.Math.*`
- Use `kotlinx-datetime` instead of `java.time.*`
- Use `padStart()`/manual formatting instead of `String.format()`
- See the project's `core/util/` for expect/actual helpers for platform-specific functionality

## Translations

Any user-facing strings must be added to **all 19 language files** in `shared/src/commonMain/composeResources/values-{locale}/strings.xml`. Do not add strings only to the default locale.

## Questions?

If you have questions about contributing, feel free to open an issue for discussion.
