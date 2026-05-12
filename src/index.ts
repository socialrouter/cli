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
  .version("0.3.0");

// ─── extract ─────────────────────────────────────────────

program
  .command("extract")
  .description("Extract data from one or more social media URLs")
  .option("-u, --url <url>", "Single social media URL")
  .option(
    "-U, --urls <urls>",
    "Comma-separated list of URLs for batch-capable actors (e.g. 'u1,u2,u3')"
  )
  .requiredOption(
    "-p, --provider <provider>",
    "Service slug provider/platform/type[:tag] (e.g. apify/linkedin/profile.info). Copy from the providers page."
  )
  .option("-l, --limit <number>", "Max records", "100")
  .option("--no-fallback", "Disable router fallback — fail if the requested provider errors")
  .option("-j, --json", "Output raw JSON")
  .action(async (opts) => {
    if (!opts.url && !opts.urls) {
      console.error(chalk.red("Error: provide either --url or --urls."));
      process.exit(1);
    }
    const client = getClient();
    const spinner = opts.json ? null : ora("Extracting data...").start();

    try {
      const urls: string[] | undefined = opts.urls
        ? opts.urls.split(",").map((u: string) => u.trim()).filter(Boolean)
        : undefined;

      const result = await client.extract({
        url: opts.url,
        urls,
        provider: opts.provider,
        limit: parseInt(opts.limit),
        fallback: opts.fallback,
      });

      if (spinner) spinner.stop();

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      printExtraction(result);
    } catch (err) {
      if (spinner) spinner.fail("Extraction failed");
      console.error(chalk.red(err instanceof Error ? err.message : "Unknown error"));
      process.exit(1);
    }
  });

// ─── search ──────────────────────────────────────────────

program
  .command("search")
  .description("Run a query-driven search (e.g. Google Maps place search)")
  .requiredOption(
    "-q, --queries <queries>",
    "Comma-separated list of search queries (terms or context-pinning URLs)"
  )
  .requiredOption(
    "-p, --provider <provider>",
    "Search service slug provider/platform/type[:tag] (e.g. apify/googlemaps/place.search)"
  )
  .option("-l, --limit <number>", "Per-query record cap", "100")
  .option("--no-fallback", "Disable router fallback — fail if the requested provider errors")
  .option("-j, --json", "Output raw JSON")
  .action(async (opts) => {
    const client = getClient();
    const spinner = opts.json ? null : ora("Searching...").start();

    try {
      const queries: string[] = opts.queries
        .split(",")
        .map((q: string) => q.trim())
        .filter(Boolean);

      if (queries.length === 0) {
        if (spinner) spinner.stop();
        console.error(chalk.red("Error: --queries must contain at least one non-empty value."));
        process.exit(1);
      }

      const result = await client.search({
        queries,
        provider: opts.provider,
        limit: parseInt(opts.limit),
        fallback: opts.fallback,
      });

      if (spinner) spinner.stop();

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      printExtraction(result);
    } catch (err) {
      if (spinner) spinner.fail("Search failed");
      console.error(chalk.red(err instanceof Error ? err.message : "Unknown error"));
      process.exit(1);
    }
  });

// ─── providers ───────────────────────────────────────────

program
  .command("providers")
  .description("List available providers")
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
        const statusColor =
          p.status === "active"
            ? chalk.green
            : p.status === "degraded"
              ? chalk.yellow
              : p.status === "down"
                ? chalk.red
                : chalk.dim;
        console.log(`  ${chalk.bold(p.name)} ${statusColor(`[${p.status}]`)}`);
        console.log(chalk.dim(`  ${p.description}`));
        console.log(chalk.dim(`  Platforms: ${p.supported_platforms.join(", ")}`));
        console.log(chalk.dim(`  Extract:   ${p.supported_types.join(", ")}`));
        if (p.supported_search_types?.length) {
          console.log(chalk.dim(`  Search:    ${p.supported_search_types.join(", ")}`));
        }
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

      if (Object.keys(usage.by_platform).length > 0) {
        console.log();
        console.log(chalk.dim("  By platform:"));
        for (const [name, data] of Object.entries(usage.by_platform)) {
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
  .description("Get extraction or search result by ID")
  .option("-j, --json", "Output raw JSON")
  .action(async (id, opts) => {
    const client = getClient();
    const spinner = opts.json ? null : ora("Fetching...").start();

    try {
      const result = await client.getExtraction(id);
      if (spinner) spinner.stop();

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      printExtraction(result);
    } catch (err) {
      if (spinner) spinner.fail("Failed");
      console.error(chalk.red(err instanceof Error ? err.message : "Unknown error"));
      process.exit(1);
    }
  });

program.parse();

// ─── helpers ─────────────────────────────────────────────

type ExtractionLike = Awaited<ReturnType<SocialRouter["extract"]>>;

function printExtraction(result: ExtractionLike): void {
  console.log();
  console.log(
    `${chalk.bold(result.kind === "search" ? "Search" : "Extraction")} ${chalk.green(result.id)}`
  );
  const provider = result.fallback_from
    ? `${result.provider} ${chalk.dim(`(requested ${result.fallback_from})`)}`
    : result.provider;
  console.log(
    chalk.dim(
      `Provider: ${provider} | Type: ${result.type} | Platform: ${result.source} | Credits: $${result.credits_used}`
    )
  );
  if (result.queries?.length) {
    console.log(chalk.dim(`Queries: ${result.queries.join(", ")}`));
  }
  console.log(
    chalk.dim(`${result.pagination.returned} of ${result.pagination.total} records returned`)
  );
  console.log();

  for (const record of result.data.slice(0, 10)) {
    const rec = record as {
      name?: string;
      title?: string;
      company?: string;
      profile_url?: string;
    };
    const headline = rec.name ?? rec.title ?? rec.profile_url ?? "(record)";
    console.log(
      `  ${chalk.bold(headline)}` +
        (rec.name && rec.title ? chalk.dim(` — ${rec.title}`) : "") +
        (rec.company ? chalk.dim(` @ ${rec.company}`) : "")
    );
  }

  if (result.data.length > 10) {
    console.log(chalk.dim(`  ... and ${result.data.length - 10} more`));
  }

  if (result.error) {
    console.log();
    console.log(chalk.red(`Error: ${result.error.message}`));
  }

  console.log();
}
