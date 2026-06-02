---
title: CI Integration
description: Triggering Rith workflows from GitHub Actions, GitLab CI, and Jenkins
category: deployment
area: infra
audience: [operator]
status: current
sidebar:
  order: 6
---

Rith is a CLI workflow engine — CI systems invoke `rith workflow run` exactly like any other build step. The CI pipeline provides issue/PR metadata via flags, and Rith returns exit code 0 on success, 1 on failure. With `--json`, structured output is written to stdout for downstream parsing.

## GitHub Actions — PR Review

```yaml
name: Rith PR Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Install Rith
        run: curl -fsSL https://raw.githubusercontent.com/artur-ciocanu/rith-engine/main/scripts/install.sh | bash

      - name: Run PR review workflow
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          rith workflow run review \
            --workflow-type pr \
            --pr-branch "${{ github.head_ref }}" \
            --pr-sha "${{ github.event.pull_request.head.sha }}" \
            --issue-context '{
              "number": ${{ github.event.pull_request.number }},
              "title": ${{ toJSON(github.event.pull_request.title) }},
              "body": ${{ toJSON(github.event.pull_request.body) }},
              "head_ref": "${{ github.head_ref }}",
              "base_ref": "${{ github.base_ref }}"
            }' \
            --json \
            "Review this pull request" \
            | tee /tmp/rith-result.json

      - name: Post review comment
        if: always()
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          SUMMARY=$(jq -r '.summary // "No summary available."' /tmp/rith-result.json)
          gh pr comment "${{ github.event.pull_request.number }}" \
            --body "## Rith Review

          $SUMMARY"
```

## GitHub Actions — Issue Implementation

```yaml
name: Rith Issue Implementation
on:
  issues:
    types: [labeled]

jobs:
  implement:
    if: github.event.label.name == 'ai-implement'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Install Rith
        run: curl -fsSL https://raw.githubusercontent.com/artur-ciocanu/rith-engine/main/scripts/install.sh | bash

      - name: Implement issue
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          rith workflow run implement \
            --workflow-type issue \
            --branch "rith/issue-${{ github.event.issue.number }}" \
            --issue-context '{
              "number": ${{ github.event.issue.number }},
              "title": ${{ toJSON(github.event.issue.title) }},
              "body": ${{ toJSON(github.event.issue.body) }},
              "labels": ${{ toJSON(github.event.issue.labels.*.name) }}
            }' \
            --json \
            "Implement this issue" \
            | tee /tmp/rith-result.json

      - name: Comment result on issue
        if: always()
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          SUCCESS=$(jq -r '.success' /tmp/rith-result.json)
          SUMMARY=$(jq -r '.summary // "No summary."' /tmp/rith-result.json)
          RUN_ID=$(jq -r '.workflowRunId // "unknown"' /tmp/rith-result.json)

          if [ "$SUCCESS" = "true" ]; then
            ICON="✅"
          else
            ICON="❌"
          fi

          gh issue comment "${{ github.event.issue.number }}" \
            --body "$ICON **Rith run \`$RUN_ID\`**

          $SUMMARY"
```

## GitLab CI

```yaml
stages:
  - review

rith-pr-review:
  stage: review
  image: ubuntu:latest
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  before_script:
    - apt-get update && apt-get install -y curl git jq
    - curl -fsSL https://raw.githubusercontent.com/artur-ciocanu/rith-engine/main/scripts/install.sh | bash
  script:
    - |
      rith workflow run review \
        --workflow-type pr \
        --pr-branch "$CI_MERGE_REQUEST_SOURCE_BRANCH_NAME" \
        --pr-sha "$CI_COMMIT_SHA" \
        --issue-context "{
          \"number\": $CI_MERGE_REQUEST_IID,
          \"title\": $(echo "$CI_MERGE_REQUEST_TITLE" | jq -Rs .),
          \"source_branch\": \"$CI_MERGE_REQUEST_SOURCE_BRANCH_NAME\",
          \"target_branch\": \"$CI_MERGE_REQUEST_TARGET_BRANCH_NAME\"
        }" \
        --json \
        "Review this merge request" \
        | tee rith-result.json
  artifacts:
    paths:
      - rith-result.json
    when: always
  variables:
    ANTHROPIC_API_KEY: $ANTHROPIC_API_KEY
```

## Jenkins

```groovy
pipeline {
    agent any

    environment {
        ANTHROPIC_API_KEY = credentials('anthropic-api-key')
    }

    stages {
        stage('Install Rith') {
            steps {
                sh 'curl -fsSL https://raw.githubusercontent.com/artur-ciocanu/rith-engine/main/scripts/install.sh | bash'
            }
        }

        stage('PR Review') {
            when {
                changeRequest()
            }
            steps {
                sh """
                    rith workflow run review \\
                      --workflow-type pr \\
                      --pr-branch "${env.CHANGE_BRANCH}" \\
                      --pr-sha "${env.GIT_COMMIT}" \\
                      --issue-context '{
                        "number": ${env.CHANGE_ID},
                        "title": "${env.CHANGE_TITLE}",
                        "source_branch": "${env.CHANGE_BRANCH}",
                        "target_branch": "${env.CHANGE_TARGET}"
                      }' \\
                      --json \\
                      "Review this pull request" \\
                      | tee rith-result.json
                """
            }
            post {
                always {
                    script {
                        def result = readJSON file: 'rith-result.json'
                        echo "Rith review ${result.success ? 'passed' : 'failed'}: ${result.summary ?: 'No summary'}"
                    }
                }
            }
        }
    }
}
```

## Output Parsing

When `--json` is passed, `rith workflow run` writes a JSON object to stdout:

```json
{
  "success": true,
  "workflowRunId": "a1b2c3d4-...",
  "summary": "Reviewed 3 files, found 1 issue..."
}
```

On failure, `error` is included instead of `summary`:

```json
{
  "success": false,
  "workflowRunId": "a1b2c3d4-...",
  "error": "Step failed: review"
}
```

Extract fields with `jq`:

```bash
# Check pass/fail
jq -e '.success' rith-result.json

# Extract summary (falls back to error message)
jq -r '.summary // .error // "No output"' rith-result.json

# Get the run ID for resume/status commands
RUN_ID=$(jq -r '.workflowRunId' rith-result.json)
rith workflow status --json | jq --arg id "$RUN_ID" '.runs[] | select(.id == $id)'
```

Post results as a PR comment with `gh`:

```bash
SUMMARY=$(jq -r '.summary // .error // "No output"' rith-result.json)
SUCCESS=$(jq -r '.success' rith-result.json)

if [ "$SUCCESS" = "true" ]; then
  gh pr comment "$PR_NUMBER" --body "## ✅ Rith Review Passed
$SUMMARY"
else
  gh pr comment "$PR_NUMBER" --body "## ❌ Rith Review Failed
$SUMMARY"
fi
```
