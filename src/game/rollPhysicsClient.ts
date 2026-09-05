import type { RerollTumbleTemplate } from "./rerollTumbles";
import { recordRollDiagnostic } from "../rollDiagnostics";

export interface PhysicsRequest {
  id: number;
  count?: number;
  variant?: number;
  playerIndexes?: number[];
}
export interface PhysicsResponse {
  id: number;
  template?: RerollTumbleTemplate;
  error?: string;
}

export class RollPhysicsClient {
  private worker?: Worker;
  private nextId = 0;
  private pending = new Map<number, { resolve: (value: RerollTumbleTemplate | undefined) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  constructor(private createWorker = () => new Worker(new URL("./rollPhysics.worker.ts", import.meta.url), { type: "module" })) {}

  request(input: Omit<PhysicsRequest, "id"> = {}): Promise<RerollTumbleTemplate | undefined> {
    return new Promise((resolve, reject) => {
      try {
        if (!this.worker) {
          this.worker = this.createWorker();
          this.worker.onmessage = ({ data }: MessageEvent<PhysicsResponse>) => {
            const job = this.pending.get(data.id);
            if (!job) return;
            clearTimeout(job.timer);
            this.pending.delete(data.id);
            if (data.error) job.reject(new Error(data.error));
            else job.resolve(data.template);
          };
          this.worker.onerror = () => this.dispose("Physics worker failed");
          this.worker.onmessageerror = () => this.dispose("Physics response could not be decoded");
        }
        const id = ++this.nextId;
        const timer = setTimeout(() => this.dispose("Physics preparation timed out"), 15000);
        this.pending.set(id, { resolve, reject, timer });
        try { this.worker.postMessage({ ...input, id }); }
        catch { this.dispose("Physics request could not be sent"); }
      } catch (error) { reject(error); }
    });
  }

  dispose(reason = "Physics worker stopped") {
    this.worker?.terminate();
    this.worker = undefined;
    for (const job of this.pending.values()) {
      clearTimeout(job.timer);
      job.reject(new Error(reason));
    }
    this.pending.clear();
  }
}

const client = new RollPhysicsClient();
export async function preloadRollPhysics() { await client.request(); }
export async function prepareRollPhysics(count: number, variant: number, playerIndexes?: number[]) {
  recordRollDiagnostic("physics-start", { count });
  const start = performance.now();
  try {
    const template = await client.request({ count, variant, playerIndexes });
    if (!template) throw new Error("Missing physics template");
    recordRollDiagnostic("physics-ready", { milliseconds: Math.round(performance.now() - start) });
    return template;
  } catch (error) {
    recordRollDiagnostic("physics-failed", { reason: String(error) });
    throw error;
  }
}

if (import.meta.hot) import.meta.hot.dispose(() => client.dispose());
