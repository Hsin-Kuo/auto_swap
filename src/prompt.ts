import { createInterface } from "readline";

// Hidden input — characters are masked with '*'
export function promptSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stderr.write(question);

    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);

    let input = "";

    const onData = (buf: Buffer) => {
      const ch = buf.toString();

      if (ch === "\n" || ch === "\r" || ch === "\u0004") {
        // Enter or Ctrl-D
        stdin.removeListener("data", onData);
        if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
        process.stderr.write("\n");
        resolve(input);
        return;
      }

      if (ch === "\u0003") {
        // Ctrl-C
        stdin.removeListener("data", onData);
        if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
        process.stderr.write("\n");
        process.exit(130);
      }

      if (ch === "\u007F" || ch === "\b") {
        // Backspace
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stderr.write("\b \b");
        }
        return;
      }

      input += ch;
      process.stderr.write("*");
    };

    stdin.resume();
    stdin.on("data", onData);
  });
}

// Normal visible input
export function promptVisible(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}
