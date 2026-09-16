import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabaseClient";
import { provisionMailbox } from "../lib/api";
import type { Domain } from "../lib/types";

function randomPassword(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 14);
}

async function fetchDomains(): Promise<Domain[]> {
  const { data, error } = await supabase.from("domains").select("*").order("domain_name");
  if (error) throw error;
  return (data as Domain[]) ?? [];
}

// One thing only: create a mailbox on a domain that's already configured
// (see AdminOnboardDomainPage). No client, no domain, no Resend account to
// pick here - just the domain and the mailbox name.
export function AdminProvisionPage() {
  const queryClient = useQueryClient();
  const { data: domains } = useQuery({ queryKey: ["domains"], queryFn: fetchDomains });
  const [domainId, setDomainId] = useState("");
  const [localPart, setLocalPart] = useState("");
  const [initialPassword, setInitialPassword] = useState(randomPassword());
  const [monthlyFeeKes, setMonthlyFeeKes] = useState(500);

  useEffect(() => {
    if (domains && !domainId) setDomainId(domains[0]?.id ?? "");
  }, [domains, domainId]);

  const selectedDomain = domains?.find((d) => d.id === domainId);

  const provision = useMutation({
    mutationFn: () => provisionMailbox({ domainId, localPart, initialPassword, monthlyFeeKes }),
    onSuccess: () => {
      setLocalPart("");
      setInitialPassword(randomPassword());
      queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    provision.mutate();
  }

  return (
    <div className="page">
      <Link to="/admin" className="back-link">
        ← Back to admin
      </Link>
      <h1>New mailbox</h1>

      {domains?.length === 0 ? (
        <p className="error">
          No domains configured yet. <Link to="/admin/domains/new">Add a domain</Link> first.
        </p>
      ) : (
        <form className="provision-form" onSubmit={handleSubmit}>
          <label>
            Domain
            <select value={domainId} onChange={(e) => setDomainId(e.target.value)}>
              {domains?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.domain_name} ({d.status})
                </option>
              ))}
            </select>
          </label>
          {selectedDomain && selectedDomain.status !== "verified" && (
            <p className="muted">
              This domain isn't verified yet - the mailbox will still be created, but mail won't flow
              until it is.
            </p>
          )}

          <label>
            Name
            <div className="inline-input">
              <input placeholder="info" value={localPart} onChange={(e) => setLocalPart(e.target.value)} required />
              <span className="muted">@{selectedDomain?.domain_name ?? "…"}</span>
            </div>
          </label>

          <label>
            Initial password
            <div className="inline-input">
              <input value={initialPassword} onChange={(e) => setInitialPassword(e.target.value)} required />
              <button type="button" onClick={() => setInitialPassword(randomPassword())}>
                Generate
              </button>
            </div>
          </label>

          <label>
            Monthly fee (KES)
            <input
              type="number"
              value={monthlyFeeKes}
              onChange={(e) => setMonthlyFeeKes(Number(e.target.value))}
            />
          </label>

          {provision.error && (
            <p className="error">
              {provision.error instanceof Error ? provision.error.message : String(provision.error)}
            </p>
          )}
          <button type="submit" disabled={provision.isPending}>
            {provision.isPending ? "Creating…" : "Create mailbox"}
          </button>
        </form>
      )}

      {provision.data && (
        <div className="provision-result">
          <h2>✅ {provision.data.address} created</h2>
          <p>Give the client this address and the password above to log in.</p>
        </div>
      )}
    </div>
  );
}
