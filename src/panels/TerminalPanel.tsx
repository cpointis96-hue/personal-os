import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

interface Props {
  panelId: string;
}

export function TerminalPanel({ panelId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      fontFamily: "JetBrains Mono, monospace",
      fontSize: 12,
      cursorBlink: true,
      theme: {
        background: "#1a1a1a",
        foreground: "#f0ece4",
        cursor: "#cc785c",
        selectionBackground: "rgba(204, 120, 92, 0.25)",
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;

    invoke("terminal_spawn", { panelId }).catch((err: unknown) => {
      term.writeln(`\r\n\x1b[31mFailed to start shell: ${String(err)}\x1b[0m`);
    });

    let unlisten: UnlistenFn | null = null;
    listen<string>(`terminal://stdout/${panelId}`, (event) => {
      term.write(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });

    term.onData((data) => {
      invoke("terminal_write", { panelId, data }).catch(() => {});
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        invoke("terminal_resize", {
          panelId,
          cols: dims.cols,
          rows: dims.rows,
        }).catch(() => {});
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      unlisten?.();
      term.dispose();
      invoke("terminal_kill", { panelId }).catch(() => {});
    };
  }, [panelId]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        padding: 8,
        boxSizing: "border-box",
        background: "#1a1a1a",
      }}
    />
  );
}
