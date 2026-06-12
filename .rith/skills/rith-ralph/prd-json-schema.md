# PRD JSON Schema

The `prd.json` file tracks stories and progress for a Ralph PRD.

## Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "RalphPRD",
  "type": "object",
  "required": ["project", "branchName", "prdFile", "description", "userStories"],
  "properties": {
    "project": {
      "type": "string",
      "description": "Project name (PascalCase)"
    },
    "branchName": {
      "type": "string",
      "description": "Git branch name, format: ralph/{slug}"
    },
    "prdFile": {
      "type": "string",
      "description": "Relative path to the PRD markdown file",
      "default": "prd.md"
    },
    "description": {
      "type": "string",
      "description": "One-line summary of the feature"
    },
    "userStories": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "#/definitions/UserStory"
      }
    }
  },
  "definitions": {
    "UserStory": {
      "type": "object",
      "required": ["id", "title", "description", "acceptanceCriteria", "technicalNotes", "dependsOn", "priority", "passes"],
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^US-\\d{3}$",
          "description": "Story identifier, format: US-001"
        },
        "title": {
          "type": "string",
          "description": "Short descriptive title"
        },
        "description": {
          "type": "string",
          "description": "User story: As a {user}, I want {capability} so that {benefit}"
        },
        "acceptanceCriteria": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string"
          },
          "description": "Pass/fail verifiable criteria. Must include type-check and test passing."
        },
        "technicalNotes": {
          "type": "string",
          "description": "Files to modify, patterns to follow, types to use — from codebase exploration"
        },
        "dependsOn": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^US-\\d{3}$"
          },
          "description": "Story IDs this depends on. Must only reference lower-priority stories."
        },
        "priority": {
          "type": "integer",
          "minimum": 1,
          "description": "Execution order. Lower number runs first."
        },
        "passes": {
          "type": "boolean",
          "description": "Whether all acceptance criteria are met",
          "default": false
        },
        "notes": {
          "type": "string",
          "description": "Implementation notes, deviations, or blockers",
          "default": ""
        }
      }
    }
  }
}
```

## Example

```json
{
  "project": "MyFeature",
  "branchName": "ralph/my-feature",
  "prdFile": "prd.md",
  "description": "Add priority field to workflow items",
  "userStories": [
    {
      "id": "US-001",
      "title": "Add priority type and schema",
      "description": "As a developer, I want a priority type so that workflows can be ordered",
      "acceptanceCriteria": [
        "Priority type exists with values 'high' | 'medium' | 'low'",
        "Type-check passes",
        "Tests pass"
      ],
      "technicalNotes": "Add to packages/core/src/types.ts, mirror existing Status type pattern",
      "dependsOn": [],
      "priority": 1,
      "passes": false,
      "notes": ""
    }
  ]
}
```
