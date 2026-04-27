#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { SocialRouter } from "@socialrouter/sdk";

function getClient(): SocialRouter {
  const apiKey = process.env.SOCIALROUTER_API_KEY;
  if (!apiKey) {
    console.error(chalk.red("Error: SOCIALROUTER_API_KEY environment variable is required."));
    console.error(chalk.dim("Set it with: export SOCIALROUTER_API_KEY=sr_live_..."));
    process.exit(1);
  }
  return new SocialRouter({
    apiKey,
    baseUrl: process.env.SOCIALROUTER_BASE_URL,
  });
}

const program = new Command();

program
  .name("socialrouter")
  .description("CLI for the SocialRouter API — extract social media data from any provider")
  .version("0.1.0");

// ─── extract ─────────────────────────────────────────────

program
  .command("extract")
  .description("Extract data from a social media URL")
  .requiredOption("-u, --url <url>", "Social media URL to extract from")
  .requiredOption("-t, --type <type>", "Extraction type (post.likes, post.comments, profile.info, profile.posts, profile.followers)")
  .option("-p, --provider <provider>", "Preferred provider (e.g. apify)")
  .option("-l, --limit <number>", "Max results", "100")
  .option("-j, --json", "Output raw JSON")
  .action(async (opts) => {
    const client = getClient();
    const spinner = opts.json ? null : ora("Extracting data...").start();

    try {
      const result = await client.extract({
        url: opts.url,
        type: opts.type,
        provider: opts.provider,
        limit: parseInt(opts.limit),
      });

      if (spinner) spinner.stop();

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      // Pretty output
      console.log();
      console.log(chalk.bold(`Extraction ${chalk.green(result.id)}`));
      console.log(chalk.dim(`Provider: ${result.provider} | Type: ${result.type} | Platform: ${result.source} | Credits: $${result.credits_used}`));
      console.log(chalk.dim(`${result.pagination.returned} of ${result.pagination.total} records returned`));
      console.log();

      for (const record of result.data.slice(0, 10)) {
        console.log(
          `  ${chalk.bold(record.name)}` +
          (record.title ? chalk.dim(` — ${record.title}`) : "") +
          (record.company ? chalk.dim(` @ ${record.company}`) : "")
        );
      }

      if (result.data.length > 10) {
        console.log(chalk.dim(`  ... and ${result.data.length - 10} more`));
      }

      console.log();
    } catch (err) {
      if (spinner) spinner.fail("Extraction failed");
      console.error(chalk.red(err instanceof Error ? err.message : "Unknown error"));
      process.exit(1);
    }
  });

// ─── providers ───────────────────────────────────────────

program
  .command("providers")
  .description("List available extraction providers")
  .option("-j, --json", "Output raw JSON")
  .action(async (opts) => {
    const client = getClient();

    try {
      const providers = await client.listProviders();

      if (opts.json) {
        console.log(JSON.stringify(providers, null, 2));
        return;
      }

      console.log();
      console.log(chalk.bold("Available Providers"));
      console.log();

      for (const p of providers) {
        const statusColor = p.status === "active" ? chalk.green : chalk.yellow;
        console.log(`  ${chalk.bold(p.name)} ${statusColor(`[${p.status}]`)}`);
        console.log(chalk.dim(`  ${p.description}`));
        console.log(chalk.dim(`  Platforms: ${p.supported_platforms.join(", ")}`));
        console.log(chalk.dim(`  Types: ${p.supported_types.join(", ")}`));
        console.log();
      }
    } catch (err) {
      console.error(chalk.red(err instanceof Error ? err.message : "Unknown error"));
      process.exit(1);
    }
  });

// ─── balance ─────────────────────────────────────────────

program
  .command("balance")
  .description("Check your credit balance")
  .option("-j, --json", "Output raw JSON")
  .action(async (opts) => {
    const client = getClient();

    try {
      const balance = await client.getBalance();

      if (opts.json) {
        console.log(JSON.stringify(balance, null, 2));
        return;
      }

      console.log();
      console.log(chalk.bold("Credit Balance"));
      console.log(`  ${chalk.green.bold(`$${balance.balance.toFixed(2)}`)} ${chalk.dim(balance.currency)}`);
      console.log();
    } catch (err) {
      console.error(chalk.red(err instanceof Error ? err.message : "Unknown error"));
      process.exit(1);
    }
  });

// ─── usage ───────────────────────────────────────────────

program
  .command("usage")
  .description("View usage summary")
  .option("-d, --days <number>", "Number of days", "30")
  .option("-j, --json", "Output raw JSON")
  .action(async (opts) => {
    const client = getClient();

    try {
      const usage = await client.getUsage(parseInt(opts.days));

      if (opts.json) {
        console.log(JSON.stringify(usage, null, 2));
        return;
      }

      console.log();
      console.log(chalk.bold(`Usage (last ${usage.period})`));
      console.log(`  Requests: ${chalk.bold(String(usage.total_requests))}`);
      console.log(`  Records:  ${chalk.bold(String(usage.total_records))}`);
      console.log(`  Credits:  ${chalk.bold(`$${usage.total_credits.toFixed(2)}`)}`);

      if (Object.keys(usage.by_provider).length > 0) {
        console.log();
        console.log(chalk.dim("  By provider:"));
        for (const [name, data] of Object.entries(usage.by_provider)) {
          console.log(`    ${name}: ${data.requests} req, ${data.records} records, $${data.credits.toFixed(2)}`);
        }
      }

      console.log();
    } catch (err) {
      console.error(chalk.red(err instanceof Error ? err.message : "Unknown error"));
      process.exit(1);
    }
  });

// ─── get ─────────────────────────────────────────────────

program
  .command("get <id>")
  .description("Get extraction result by ID")
  .option("-j, --json", "Output raw JSON")
  .action(async (id, opts) => {
    const client = getClient();
    const spinner = opts.json ? null : ora("Fetching extraction...").start();

    try {
      const result = await client.getExtraction(id);
      if (spinner) spinner.stop();

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log();
      console.log(chalk.bold(`Extraction ${chalk.green(result.id)}`));
      console.log(chalk.dim(`Status: ${result.status} | Provider: ${result.provider} | Type: ${result.type} | Credits: $${result.credits_used}`));
      console.log(chalk.dim(`${result.data.length} records`));

      if (result.error) {
        console.log(chalk.red(`Error: ${result.error.message}`));
      }

      console.log();
    } catch (err) {
      if (spinner) spinner.fail("Failed");
      console.error(chalk.red(err instanceof Error ? err.message : "Unknown error"));
      process.exit(1);
    }
  });

program.parse();
