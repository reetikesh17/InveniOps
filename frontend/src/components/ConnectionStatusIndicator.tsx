import { useHealthStatus, type ConnectionStatus } from "../hooks/useHealthStatus";

const STATUS_CONFIG: Record<ConnectionStatus, { label: string; dotClassName: string }> = {
  checking: { label: "Checking…", dotClassName: "bg-neutral-400" },
  connected: { label: "Connected", dotClassName: "bg-emerald-500" },
  disconnected: { label: "Disconnected", dotClassName: "bg-red-500" },
};

export function ConnectionStatusIndicator(): JSX.Element {
  const status = useHealthStatus();
  const { label, dotClassName } = STATUS_CONFIG[status];

  return (
    <div className="flex items-center gap-2 text-sm text-neutral-600">
      <span className={`h-2 w-2 rounded-full ${dotClassName}`} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
