import { useParams } from "react-router-dom";

export function IncidentDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();

  return (
    <div>
      <h1 className="text-2xl font-semibold text-neutral-900">Incident {id}</h1>
      <p className="mt-2 text-neutral-500">Coming soon.</p>
    </div>
  );
}
