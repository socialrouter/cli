#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import {
  SocialRouter,
  SERVICE_INPUT_KIND,
  type CatalogueService,
  type Extraction,
} from "@socialrouter/sdk";

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
    client: "cli",
  });
}

const program = new Command();

program
  .name("socialrouter")
  .description("CLI for the SocialRouter API, one endpoint per service, routed across sources")
  .version("0.4.0");

// ─── run ─────────────────────────────────────────────────

program
  .command("run")
  .description("Run a service over one or more inputs")
  .argument("<service>", "Service slug <platform>/<service>, e.g. reddit/subreddit.posts")
  .argument(
    "<inputs...>",
    "URLs (url services) or search queries (query services). Quote queries containing spaces.",
  )
  .option(
    "-p, --provider <offer>",
    "Pin one offer, e.g. apify/harshmaur. Omit to let the router pick and fail over.",
  )
  .option("-l, --limit <number>", "Max records", "100")
  .option(
    "-o, --options <json>",
    "Typed options as a JSON object (e.g. '{\"sort\":\"top\"}'). Run `socialrouter services <slug>` to see what a service accepts.",
  )
  .option("-j, --json", "Output raw JSON")
  .action(async (service: string, inputs: string[], opts) => {
    let serviceOptions: Record<string, unknown> | undefined;
    if (opts.options !== undefined) {
      try {
        const parsed: unknown = JSON.parse(opts.options);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("must be a JSON object");
        }
        serviceOptions = parsed as Record<string, unknown>;
      } catch (e) {
        console.error(
          chalk.red(
            `Error: --options must be a JSON object string (${
              e instanceof Error ? e.message : "parse error"
            }).`,
          ),
        );
        process.exit(1);
      }
    }

    const limit = Number(opts.limit);
    if (!Number.isInteger(limit) || limit < 1) {
      console.error(chalk.red("Error: --limit must be a positive integer."));
      process.exit(1);
    }

    const client = getClient();
    const spinner = opts.json ? null : ora(`Running ${service}...`).start();

    try {
      const field = await inputField(client, service);
      const result = await runService(client, service, {
        [field]: inputs,
        ...(opts.provider ? { provider: opts.provider } : {}),
        limit,
        ...(serviceOptions ? { options: serviceOptions } : {}),
      });

      if (spinner) spinner.stop();

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      printRun(result);
    } catch (err) {
      if (spinner) spinner.fail("Run failed");
      console.error(chalk.red(err instanceof Error ? err.message : "Unknown error"));
      process.exit(1);
    }
  });

// ─── services ────────────────────────────────────────────

program
  .command("services")
  .description("Browse the service catalogue")
  .argument(
    "[filter]",
    "A platform (e.g. reddit) or a full service slug (e.g. reddit/subreddit.posts) for the detailed view",
  )
  .option("-j, --json", "Output raw JSON")
  .action(async (filter: string | undefined, opts) => {
    const client = getClient();

    try {
      // A slug (contains "/") gets the detailed view: input shapes, typed
      // options and every offer. A bare platform, or nothing, lists.
      if (filter?.includes("/")) {
        const service = await client.getService(filter as Parameters<typeof client.getService>[0]);
        if (opts.json) {
          console.log(JSON.stringify(service, null, 2));
          return;
        }
        printServiceDetail(service);
        return;
      }

      const services = await client.listServices(
        filter ? ({ platform: filter } as Parameters<typeof client.listServices>[0]) : undefined,
      );

      if (opts.json) {
        console.log(JSON.stringify(services, null, 2));
        return;
      }

      console.log();
      console.log(chalk.bold(filter ? `Services on ${filter}` : "Services"));
      let platform = "";
      for (const s of services) {
        if (s.platform !== platform) {
          platform = s.platform;
          console.log();
          console.log(chalk.bold(`  ${platform}`));
        }
        const from = Math.min(...s.offers.map((o) => o.price_per_record));
        console.log(
          `    ${chalk.green(`${s.platform}/${s.service}`)} ` +
            chalk.dim(
              `${s.input_field} · from $${from}/record · ${s.offers.length} offer${s.offers.length > 1 ? "s" : ""}`,
            ),
        );
      }
      console.log();
      console.log(chalk.dim("  Details: socialrouter services <platform>/<service>"));
      console.log();
    } catch (err) {
      console.error(chalk.red(err instanceof Error ? err.message : "Unknown error"));
      process.exit(1);
    }
  });

// ─── sources ─────────────────────────────────────────────

program
  .command("sources")
  .description("List the data sources behind the offers")
  .option("-j, --json", "Output raw JSON")
  .action(async (opts) => {
    const client = getClient();

    try {
      const sources = await client.listSources();

      if (opts.json) {
        console.log(JSON.stringify(sources, null, 2));
        return;
      }

      console.log();
      console.log(chalk.bold("Sources"));
      console.log();

      for (const s of sources) {
        const statusColor =
          s.status === "active"
            ? chalk.green
            : s.status === "degraded"
              ? chalk.yellow
              : s.status === "down"
                ? chalk.red
                : chalk.dim;
        console.log(`  ${chalk.bold(s.name)} ${statusColor(`[${s.status}]`)} ${chalk.dim(`(${s.id})`)}`);
        console.log(chalk.dim(`  ${s.description}`));
        console.log(chalk.dim(`  Platforms: ${s.platforms.join(", ")}`));
        console.log(chalk.dim(`  ${s.services_count} services · ${s.offers_count} offers`));
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
        console.log(chalk.dim("  By offer:"));
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
  .description("Get a past run by ID")
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

      printRun(result);
    } catch (err) {
      if (spinner) spinner.fail("Failed");
      console.error(chalk.red(err instanceof Error ? err.message : "Unknown error"));
      process.exit(1);
    }
  });

program.parse();

// ─── helpers ─────────────────────────────────────────────

/**
 * The CLI dispatches over a runtime slug, so the SDK's per-service typing
 * can't apply — this is the one boundary where the shape is decided at
 * runtime instead of by the compiler.
 */
type AnyRunInput = {
  urls?: string[];
  queries?: string[];
  provider?: `${string}/${string}`;
  limit?: number;
  options?: Record<string, unknown>;
};

function runService(
  client: SocialRouter,
  service: string,
  input: AnyRunInput,
): Promise<Extraction> {
  return (client.run as unknown as (s: string, i: AnyRunInput) => Promise<Extraction>)(
    service,
    input,
  );
}

/**
 * Which body field carries the inputs: `urls` for a URL service, `queries`
 * for a query one. Known services resolve offline from the SDK's generated
 * map; anything newer than this CLI release is looked up in the live
 * catalogue rather than guessed.
 */
async function inputField(client: SocialRouter, service: string): Promise<"urls" | "queries"> {
  const known = (SERVICE_INPUT_KIND as Record<string, "url" | "query">)[service];
  if (known) return known === "query" ? "queries" : "urls";

  const catalogue = await client.listServices();
  const match = catalogue.find((s) => `${s.platform}/${s.service}` === service);
  if (!match) {
    const platform = service.split("/")[0];
    const onPlatform = catalogue.filter((s) => s.platform === platform);
    const suggestions = (onPlatform.length ? onPlatform : catalogue)
      .map((s) => `${s.platform}/${s.service}`)
      .slice(0, 12);
    throw new Error(
      `Unknown service "${service}". Available: ${suggestions.join(", ")}.\n` +
        "Run `socialrouter services` for the full catalogue.",
    );
  }
  return match.input_field;
}

function printRun(result: Extraction): void {
  console.log();
  console.log(`${chalk.bold("Run")} ${chalk.green(result.id)}`);
  const servedBy = result.served_by
    ? result.fallback_from
      ? `${result.served_by} ${chalk.dim(`(fell over from ${result.fallback_from})`)}`
      : result.served_by
    : chalk.dim("none");
  console.log(
    chalk.dim(
      `Service: ${result.platform}/${result.service} | Served by: ${servedBy} | Credits: $${result.credits_used}`,
    ),
  );
  if (result.queries?.length) {
    console.log(chalk.dim(`Queries: ${result.queries.join(", ")}`));
  }
  console.log(
    chalk.dim(`${result.pagination.returned} of ${result.pagination.total} records returned`),
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
        (rec.name && rec.title ? chalk.dim(` · ${rec.title}`) : "") +
        (rec.company ? chalk.dim(` @ ${rec.company}`) : ""),
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

function printServiceDetail(s: CatalogueService): void {
  console.log();
  console.log(chalk.bold(`${s.platform}/${s.service}`));
  console.log(chalk.dim(`  POST ${s.endpoint} · body field: ${s.input_field}`));
  console.log();

  console.log(chalk.bold("  Input"));
  for (const a of s.accepts) {
    console.log(`    ${a.format}`);
    console.log(chalk.dim(`      e.g. ${a.example}`));
    if (a.note) console.log(chalk.dim(`      ${a.note}`));
  }
  if (s.accepts.length === 0) console.log(chalk.dim("    (not advertised)"));
  console.log();

  if (s.options.length > 0) {
    console.log(chalk.bold("  Options"));
    for (const o of s.options) {
      const type = o.type === "enum" ? (o.values ?? []).join(" | ") : o.type;
      console.log(`    ${chalk.green(o.name)} ${chalk.dim(`(${type})`)}`);
      console.log(
        chalk.dim(
          `      ${o.description}` +
            (o.default !== undefined ? ` Default: ${JSON.stringify(o.default)}.` : ""),
        ),
      );
    }
    console.log();
  }

  console.log(chalk.bold("  Offers"), chalk.dim("(failover order, the head serves by default)"));
  s.offers.forEach((o, i) => {
    console.log(
      `    ${chalk.green(o.offer)} ${chalk.dim(
        `$${o.price_per_record}/record · up to ${o.max_inputs} inputs`,
      )}${i === 0 ? chalk.dim(" · default route") : ""}`,
    );
  });
  console.log();
  console.log(
    chalk.dim(
      `  Run it: socialrouter run ${s.platform}/${s.service} "${s.accepts[0]?.example ?? "<input>"}"`,
    ),
  );
  console.log();
}
