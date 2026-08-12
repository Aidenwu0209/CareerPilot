async function main() {
  process.env.CAREERPILOT_SKIP_DEMO_SEED = '1';
  const [catalog, loader, database] = await Promise.all([
    import('../src/lib/career/catalog-import'),
    import('../src/lib/career/catalog-loader'),
    import('../src/lib/db'),
  ]);
  const [action, target] = process.argv.slice(2);
  if (!['dry-run', 'stage', 'apply', 'rollback'].includes(action) || !target) {
    throw new Error('Usage: pnpm career:catalog <dry-run|stage> <catalog-directory> | <apply|rollback> <catalog-version>');
  }

  try {
    if (action === 'dry-run' || action === 'stage') {
      const bundle = await loader.loadCareerCatalogDirectory(target);
      const diff = action === 'dry-run'
        ? await catalog.dryRunCareerCatalog(bundle)
        : await catalog.stageCareerCatalog(bundle);
      process.stdout.write(`${JSON.stringify({ action, diff }, null, 2)}\n`);
      if (diff.blockingErrors.length) process.exitCode = 1;
      return;
    }
    if (action === 'apply') await catalog.applyCareerCatalog(target);
    else await catalog.rollbackCareerCatalog(target);
    process.stdout.write(`${JSON.stringify({ action, version: target, active: true }, null, 2)}\n`);
  } finally {
    await database.adapter.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
