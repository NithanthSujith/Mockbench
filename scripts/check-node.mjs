// Fails `pnpm install` with a clear message unless running on Node 22.x (FND-01).
const major = Number(process.versions.node.split('.')[0])
if (major !== 22) {
  console.error(
    `\nMockbench requires Node 22 (found ${process.versions.node}). ` +
      `Use \`nvm use\` (see .nvmrc) or install Node 22 LTS.\n`,
  )
  process.exit(1)
}
