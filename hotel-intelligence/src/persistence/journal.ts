import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AuditEntry } from '../decision/approval';
import type { DateKey, Observation } from '../types';

/**
 * The platform's state is a deterministic function of three things: the observations it was given,
 * which days were closed, and which human decisions were made. So durability is an append-only
 * journal of exactly those, and recovery is a replay (tests assert replay reproduces the same
 * brief and approval states). No schema migrations, and conclusions improve when the engines do.
 */
export type JournalEntry =
  | { t: 'obs'; obs: Observation[] }
  | { t: 'close'; date: DateKey }
  | { t: 'audit'; entry: AuditEntry }
  /** A notification that was sent. Read by the delivery service, ignored when rebuilding analysis state. */
  | { t: 'delivered'; key: string };

export interface JournalSink {
  append(entry: JournalEntry): void;
}

export class JournalCorruptionError extends Error {}

/** JSON-lines journal on local disk. Swap for a log/stream behind the same interface when scaling out. */
export class FileJournal implements JournalSink {
  constructor(private path: string) {
    mkdirSync(dirname(path), { recursive: true });
  }

  append(entry: JournalEntry): void {
    // Synchronous append: a request is acknowledged only after its input is on disk.
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`);
  }

  /**
   * Reads every entry. A torn *final* line (crash mid-write) is dropped and reported; a bad line
   * anywhere else means real corruption and is an error rather than something to silently skip.
   */
  readAll(): { entries: JournalEntry[]; droppedPartialTail: boolean } {
    if (!existsSync(this.path)) return { entries: [], droppedPartialTail: false };
    const lines = readFileSync(this.path, 'utf8').split('\n');
    const entries: JournalEntry[] = [];
    let dropped = false;
    lines.forEach((line, i) => {
      if (!line.trim()) return;
      try {
        entries.push(JSON.parse(line) as JournalEntry);
      } catch {
        const isLastNonEmpty = lines.slice(i + 1).every((l) => !l.trim());
        if (!isLastNonEmpty) throw new JournalCorruptionError(`Journal line ${i + 1} is not valid JSON`);
        dropped = true;
      }
    });
    return { entries, droppedPartialTail: dropped };
  }
}
