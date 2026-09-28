#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import {
  SocialRouter,
  type ByokMode,
  type ByokModeSettings,
  type CatalogueService,
  type Extraction,
  type ProviderCredential,
} from "@socialrouter/sdk";
import { inputField } from "./input-field.js";
import { describeError } from "./errors.js";
import { readSecret } from "./secret.js";

function getClient(): SocialRouter {
  const apiKey = process.env.SOCIALROUTER_API_KEY;
  if (!apiKey) {
    console.error(chalk.red("Error: SOCIALROUTER_API_KEY environment variable is required."));
    console.error(chalk.dim("Set it with: export SOCIALROUTER_API_KEY=sr_live_..."));
    console.error(
      chalk.dim("Create a key at: https://www.socialrouter.io/dashboard/keys"),
    );
    process.exit(1);
  }
  return new SocialRouter({
    apiKey,
    baseUrl: process.env.SOCIALROUTER_BASE_URL,
    client: "cli",
  });
}

/**
 * Read from package.json rather than hardcoded: the literal here said 0.4.0
 * while the published package was 0.4.1, so `--version` misreported itself
 * and there was nothing to notice it. `npm version` is now the only place a
 * release touches, and npm always ships package.json in the tarball.
 */
const VERSION = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

const program = new Command();

program
  .name("socialrouter")
  .description("CLI for the SocialRouter API, one endpoint per service, routed across sources")
  .version(VERSION);

// ─── run ─────────────────────────────────────────────────

program
  .command("run")
  .description("Run a service over one or more inputs")
  .argument(
    "<service>",
    "Service slug <subject>/<service>, e.g. reddit/subreddit.posts or person/info",
  )
  .argument(
    "<inputs...>",
    "URLs (url services), search queries (query services), or identifiers such as an email or a domain (enrichment services). Quote queries containing spaces.",
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
      printError(err);
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
      printError(err);
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
      printError(err);
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
      printError(err);
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
      printError(err);
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
      printError(err);
      process.exit(1);
    }
  });

// ─── credentials ─────────────────────────────────────────

const credentials = program
  .command("credentials")
  .description("Manage your own provider keys (bring your own key)");

credentials
  .command("list", { isDefault: true })
  .description("List the provider credentials registered on your account")
  .option("-j, --json", "Output raw JSON")
  .action(async (opts) => {
    const client = getClient();
    try {
      const list = await client.listCredentials();
      if (opts.json) {
        console.log(JSON.stringify(list, null, 2));
        return;
      }
      console.log();
      console.log(chalk.bold("Provider credentials"));
      if (list.length === 0) {
        console.log(chalk.dim("  None registered. Add one: socialrouter credentials set <source>"));
      }
      for (const c of list) printCredential(c);
      console.log();
    } catch (err) {
      printError(err);
      process.exit(1);
    }
  });

credentials
  .command("set")
  .description(
    "Register or replace the token for a source. The token is read from stdin, or prompted for without echo — never passed as an argument.",
  )
  .argument("<source>", "Source id, e.g. apify")
  .option("--label <label>", "A name for this credential")
  .option("-j, --json", "Output raw JSON")
  .action(async (source: string, opts) => {
    const client = getClient();
    const token = await readSecret(`${source} API token: `);
    if (!token) {
      console.error(chalk.red("Error: no token given. Pipe it on stdin or type it at the prompt."));
      process.exit(1);
    }
    const spinner = opts.json ? null : ora(`Verifying the token with ${source}...`).start();
    try {
      const credential = await client.setCredential(
        source,
        token,
        opts.label !== undefined ? { label: opts.label } : undefined,
      );
      if (spinner) spinner.succeed(`${source} credential saved`);
      if (opts.json) {
        console.log(JSON.stringify(credential, null, 2));
        return;
      }
      printCredential(credential);
      console.log();
    } catch (err) {
      if (spinner) spinner.fail("Not saved");
      printError(err);
      process.exit(1);
    }
  });

credentials
  .command("rename")
  .description("Rename a source's credential. Omit the label to clear it.")
  .argument("<source>", "Source id, e.g. apify")
  .argument("[label]", "The new label")
  .option("-j, --json", "Output raw JSON")
  .action(async (source: string, label: string | undefined, opts) => {
    const client = getClient();
    try {
      const credential = await client.renameCredential(source, label ?? null);
      if (opts.json) {
        console.log(JSON.stringify(credential, null, 2));
        return;
      }
      printCredential(credential);
      console.log();
    } catch (err) {
      printError(err);
      process.exit(1);
    }
  });

credentials
  .command("remove")
  .description("Revoke a source's credential")
  .argument("<source>", "Source id, e.g. apify")
  .option("-j, --json", "Output raw JSON")
  .action(async (source: string, opts) => {
    const client = getClient();
    try {
      const res = await client.removeCredential(source);
      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
        return;
      }
      console.log(chalk.green(`${res.source} credential revoked.`));
    } catch (err) {
      printError(err);
      process.exit(1);
    }
  });

// ─── byok-mode ───────────────────────────────────────────

const BYOK_MODES: ByokMode[] = ["own_first", "platform_first", "own_only", "platform_only"];

const byokMode = program
  .command("byok-mode")
  .description("Which account runs are billed to: your own provider keys or SocialRouter credits");

byokMode
  .command("show", { isDefault: true })
  .description("Show the account default and the sources that depart from it")
  .option("-j, --json", "Output raw JSON")
  .action(async (opts) => {
    const client = getClient();
    try {
      const settings = await client.getByokMode();
      if (opts.json) {
        console.log(JSON.stringify(settings, null, 2));
        return;
      }
      printByokMode(settings);
    } catch (err) {
      printError(err);
      process.exit(1);
    }
  });

byokMode
  .command("set")
  .description(`Set the account default, or one source's mode with --source. Modes: ${BYOK_MODES.join(", ")}`)
  .argument("<mode>", BYOK_MODES.join(" | "))
  .option("-s, --source <source>", "Scope the mode to one source, e.g. apify")
  .option("-j, --json", "Output raw JSON")
  .action(async (mode: string, opts) => {
    // Checked here as well as by the API: a typo should not cost a round
    // trip, and the list of modes is part of the SDK's types.
    if (!(BYOK_MODES as string[]).includes(mode)) {
      console.error(chalk.red(`Error: unknown mode "${mode}". Modes: ${BYOK_MODES.join(", ")}.`));
      process.exit(1);
    }
    const client = getClient();
    try {
      const settings = await client.setByokMode(
        mode as ByokMode,
        opts.source ? { source: opts.source } : undefined,
      );
      if (opts.json) {
        console.log(JSON.stringify(settings, null, 2));
        return;
      }
      printByokMode(settings);
    } catch (err) {
      printError(err);
      process.exit(1);
    }
  });

byokMode
  .command("clear")
  .description("Drop a source's own mode, so it follows the account default again")
  .requiredOption("-s, --source <source>", "The source to reset, e.g. apify")
  .option("-j, --json", "Output raw JSON")
  .action(async (opts) => {
    const client = getClient();
    try {
      const settings = await client.setByokMode(null, { source: opts.source });
      if (opts.json) {
        console.log(JSON.stringify(settings, null, 2));
        return;
      }
      printByokMode(settings);
    } catch (err) {
      printError(err);
      process.exit(1);
    }
  });

program.parse();

// ─── helpers ─────────────────────────────────────────────

function printError(err: unknown): void {
  const [first, ...rest] = describeError(err);
  console.error(chalk.red(first));
  for (const line of rest) console.error(chalk.dim(line));
}

function printCredential(c: ProviderCredential): void {
  const status = c.status === "active" ? chalk.green("[active]") : chalk.red("[invalid]");
  console.log(`  ${chalk.bold(c.source)} ${status}${c.label ? chalk.dim(` ${c.label}`) : ""}`);
  console.log(
    chalk.dim(
      `    verified ${c.last_verified_at ?? "never"} · last used ${c.last_used_at ?? "never"}`,
    ),
  );
}

function printByokMode(s: ByokModeSettings): void {
  console.log();
  console.log(`${chalk.bold("Default:")} ${chalk.green(s.byok_mode)}`);
  const overrides = Object.entries(s.source_modes);
  if (overrides.length > 0) {
    console.log(chalk.bold("Per source:"));
    for (const [source, mode] of overrides) console.log(`  ${source}: ${chalk.green(mode)}`);
  }
  console.log(chalk.dim(`Sources that accept your key: ${s.byok_sources.join(", ") || "none"}`));
  if (s.byok_only_sources.length > 0) {
    console.log(chalk.dim(`Reachable only with your key: ${s.byok_only_sources.join(", ")}`));
  }
  console.log();
}

/**
 * The CLI dispatches over a runtime slug, so the SDK's per-service typing
 * can't apply — this is the one boundary where the shape is decided at
 * runtime instead of by the compiler.
 */
type AnyRunInput = {
  urls?: string[];
  queries?: string[];
  identifiers?: string[];
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


function printRun(result: Extraction): void {
  console.log();
  console.log(`${chalk.bold("Run")} ${chalk.green(result.id)}`);
  const servedBy = result.served_by
    ? result.fallback_from
      ? `${result.served_by} ${chalk.dim(`(fell over from ${result.fallback_from})`)}`
      : result.served_by
    : chalk.dim("none");
  // Who paid is stated, never inferred: a failover chain can mix accounts.
  const billed = result.billed_as === "own" ? " | Billed to: your provider key" : "";
  console.log(
    chalk.dim(
      `Service: ${result.platform}/${result.service} | Served by: ${servedBy} | Credits: $${result.credits_used}${billed}`,
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
      console.log(
        `    ${chalk.green(o.name)} ${chalk.dim(`(${type})`)}${o.required ? chalk.yellow(" required") : ""}`,
      );
      console.log(
        chalk.dim(
          `      ${o.description}` +
            (o.default !== undefined ? ` Default: ${JSON.stringify(o.default)}.` : "") +
            (o.example !== undefined ? ` Example: ${JSON.stringify(o.example)}.` : ""),
        ),
      );
      // Only the listed offers read it; the others ignore it.
      if (o.offers?.length) console.log(chalk.dim(`      Only honoured by: ${o.offers.join(", ")}`));
    }
    console.log();
  }

  console.log(chalk.bold("  Offers"), chalk.dim("(failover order, the head serves by default)"));
  s.offers.forEach((o, i) => {
    console.log(
      `    ${chalk.green(o.offer)} ${chalk.dim(
        o.requires_own_key
          ? `your own ${o.source} key · up to ${o.max_inputs} inputs`
          : `$${o.price_per_record}/record · up to ${o.max_inputs} inputs`,
      )}${i === 0 ? chalk.dim(" · default route") : ""}`,
    );
  });
  console.log();
  // A required option has to be in the example, or the example is a 400.
  const required = Object.fromEntries(
    s.options.filter((o) => o.required).map((o) => [o.name, o.example ?? `<${o.name}>`]),
  );
  const optionsFlag = Object.keys(required).length ? ` --options '${JSON.stringify(required)}'` : "";
  console.log(
    chalk.dim(
      `  Run it: socialrouter run ${s.platform}/${s.service} "${s.accepts[0]?.example ?? "<input>"}"${optionsFlag}`,
    ),
  );
  console.log();
}
