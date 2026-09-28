import { createInterface } from "node:readline";

/*
 * Reading a provider token.
 *
 * Never from argv: an argument lands in shell history and in `ps` output for
 * anyone on the machine, and a provider token spends real money. Piped stdin
 * is the scripting path (`echo "$APIFY_TOKEN" | socialrouter credentials set
 * apify`); a terminal gets a prompt that does not echo.
 */

export async function readSecret(
  prompt: string,
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stderr,
): Promise<string> {
  if (!input.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of input) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8").trim();
  }

  const rl = createInterface({ input, output, terminal: true });
  // Swallow the echo of what is typed; the prompt itself still prints.
  let muted = false;
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s) => {
    if (!muted) output.write(s);
  };
  try {
    return await new Promise<string>((resolve) => {
      rl.question(prompt, (answer) => resolve(answer.trim()));
      muted = true;
    });
  } finally {
    output.write("\n");
    rl.close();
  }
}
