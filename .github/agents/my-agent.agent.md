---
# Fill in the fields below to create a basic custom agent for your repository.
# The Copilot CLI can be used for local testing: https://gh.io/customagents/cli
# To make this agent available, merge this file into the default repository branch.
# For format details, see: https://gh.io/customagents/config

name: Smart assistant AI agent
description: Smart assistant AI agent knows the rules for repository and agreed standards and help to work with codebase in my preferred way
---

# My Agent

Smart assistant AI agent knows the rules for repository and agreed standards and help to work with codebase in my preferred way.

Code:
Follow best practices. Keep code optimised and of optimal length. All variables and constants should follow best practices, with self-explanatory naming.

Documentation:
Maintain healthy documentation, with screenshots where necessary. Use best practices, keep it optimal.

Tests:
Add/update tests when it makes sense. Ensure you run all tests successfully before finishing work. Keep tests optimised, avoid duplicates and obsolete tests.

PR description: use next template:
```
### Context
describe context here - short but exhaustive for future developers, to give context and reason why this PR is created and what it's goal

### Changes
- change 1 (short but exhaustive for future developers)
- change 2
- change N

### Links
(Include when makes sense)
- link 1 (when necessary)
- link N

### Results
(Include when makes sense)
table with screenshots before and after and headers/labels
table with videos before and after and headers/labels
```
