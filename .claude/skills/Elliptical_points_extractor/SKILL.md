```markdown
# Elliptical_points_extractor Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches you how to contribute to the `Elliptical_points_extractor` project, a TypeScript codebase scaffolded with Vite. You'll learn the project's coding conventions, file organization, and how to run and write tests. This guide also provides command suggestions for common development workflows.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `ellipticalPointsExtractor.ts`

### Import Style
- Use **relative imports** for modules within the project.
  - Example:
    ```typescript
    import { extractPoints } from './pointUtils';
    ```

### Export Style
- Both **named** and **default exports** are used.
  - Named export example:
    ```typescript
    export function extractPoints(...) { ... }
    ```
  - Default export example:
    ```typescript
    export default EllipticalPointsExtractor;
    ```

### Commit Messages
- Freeform style, no enforced prefixes.
- Average commit message length: ~40 characters.
- Example:  
  ```
  Add function to filter elliptical points
  ```

## Workflows

### Project Setup
**Trigger:** When starting work on the repository for the first time  
**Command:** `/setup`

1. Clone the repository.
2. Install dependencies:
    ```bash
    npm install
    ```
3. Start the development server:
    ```bash
    npm run dev
    ```

### Adding a New Feature
**Trigger:** When implementing a new functionality  
**Command:** `/add-feature`

1. Create a new TypeScript file using camelCase naming.
2. Use relative imports to include any utilities or components.
3. Export your feature using named or default exports as appropriate.
4. Write or update corresponding tests (see Testing Patterns).
5. Commit your changes with a clear, concise message.

### Running Tests
**Trigger:** To verify code correctness  
**Command:** `/test`

1. Identify test files (pattern: `*.test.*`).
2. Run the test command (replace with actual test runner if known):
    ```bash
    npm test
    ```
   or  
    ```bash
    npm run test
    ```

### Refactoring Code
**Trigger:** When improving or reorganizing existing code  
**Command:** `/refactor`

1. Update file names to camelCase if needed.
2. Ensure all imports are relative.
3. Adjust exports to match project style.
4. Update or add tests as necessary.
5. Commit changes with a descriptive message.

## Testing Patterns

- Test files follow the pattern: `*.test.*`
  - Example: `extractPoints.test.ts`
- Testing framework is **unknown**; check for existing test scripts or dependencies.
- Place tests alongside source files or in a dedicated `tests` directory.
- Example test structure:
    ```typescript
    import { extractPoints } from './extractPoints';

    test('extracts points from ellipse', () => {
      const points = extractPoints(...);
      expect(points).toEqual([...]);
    });
    ```

## Commands
| Command      | Purpose                                   |
|--------------|-------------------------------------------|
| /setup       | Set up the project for development        |
| /add-feature | Add a new feature or module               |
| /test        | Run all tests in the project              |
| /refactor    | Refactor code to match project conventions|
```
