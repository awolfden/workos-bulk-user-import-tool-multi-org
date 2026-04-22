#!/usr/bin/env tsx
/**
 * WorkOS Migration Toolkit - CLI Entry Point
 *
 * Single entry point for all migration commands.
 * Usage: npx workos-migrate <command> [options]
 */

import 'dotenv/config';
import { Command } from 'commander';

import { registerCommand as registerWizard } from './migrate-wizard.js';
import { registerCommand as registerImport } from './import-users.js';
import { registerCommand as registerValidate } from './validate-csv.js';
import { registerCommand as registerAnalyze } from './analyze-errors.js';
import { registerCommand as registerTransformClerk } from './transform-clerk.js';
import { registerCommand as registerTransformFirebase } from './transform-firebase.js';
import { registerCommand as registerExportAuth0 } from './export-auth0.js';
import { registerCommand as registerMergePasswords } from './merge-auth0-passwords.js';
import { registerCommand as registerMapFields } from './map-fields.js';
import { registerCommand as registerProcessRoles } from './process-role-definitions.js';

const program = new Command();

program
  .name('workos-migrate')
  .description('WorkOS Migration Toolkit — import users, validate CSVs, transform exports, and more')
  .version('2.0.0');

// Register all subcommands
registerWizard(program);
registerImport(program);
registerValidate(program);
registerAnalyze(program);
registerTransformClerk(program);
registerTransformFirebase(program);
registerExportAuth0(program);
registerMergePasswords(program);
registerMapFields(program);
registerProcessRoles(program);

// Default: run wizard when no subcommand given
program.action((_opts, cmd) => {
  const wizardCmd = cmd.commands.find((c: Command) => c.name() === 'wizard');
  if (wizardCmd) {
    wizardCmd.parse(process.argv);
  }
});

program.parse();
