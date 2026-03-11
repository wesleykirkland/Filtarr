#!/usr/bin/env node

const [, , rawTitle = ''] = process.argv;
const title = rawTitle.trim();

const conventionalTitlePattern =
  /^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([a-z0-9][a-z0-9._/-]*\))?(!)?: .+/;

if (conventionalTitlePattern.test(title)) {
  console.log(`✅ Conventional PR title accepted: ${title}`);
  process.exit(0);
}

console.error('PR titles must follow Conventional Commits so squash merges remain releaseable.');
console.error('Examples:');
console.error('  feat(ci): add semantic-release dry run');
console.error('  fix(api)!: require auth for API keys');
console.error('  chore(docs): clarify release tag mapping');
console.error(`Received: ${title || '(empty title)'}`);
process.exit(1);