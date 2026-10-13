#!/usr/bin/env node
/* Hulpopdrachten voor een documentrepo die vic-redactie gebruikt.

     npx vic-redactie client <doelpad>     client/laag.js kopiëren naar de webapp-map
     npx vic-redactie skill [<repo>]       de skill in .claude/skills/redactietafel/ zetten
     npx vic-redactie pad                  waar het pakket staat (voor Python-wrappers)

   Claude Code leest geen skills uit node_modules, en Vercel serveert niets uit
   node_modules; vandaar het kopiëren. Doe dit opnieuw na het pinnen van een nieuwe tag. */
const { copyFileSync, mkdirSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');

const root = resolve(__dirname, '..');
const [wat, arg] = process.argv.slice(2);

if (wat === 'client') {
  const doel = resolve(arg || 'webapp/vic-redactie/laag.js');
  mkdirSync(dirname(doel), { recursive: true });
  copyFileSync(join(root, 'client/laag.js'), doel);
  console.log('client/laag.js → ' + doel);
} else if (wat === 'skill') {
  const doel = resolve(arg || '.', '.claude/skills/redactietafel/SKILL.md');
  mkdirSync(dirname(doel), { recursive: true });
  copyFileSync(join(root, 'skills/redactietafel/SKILL.md'), doel);
  console.log('skill → ' + doel);
} else if (wat === 'pad') {
  console.log(root);
} else {
  console.log('gebruik: vic-redactie client <doelpad> | skill [<repo>] | pad');
  process.exit(wat ? 1 : 0);
}
