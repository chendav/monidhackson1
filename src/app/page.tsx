import { FileSearch2, LockKeyhole, ScanText } from "lucide-react";

export default function HomePage() {
  return (
    <main className="shell">
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label="RFP X-Ray home">
          <ScanText aria-hidden="true" size={20} />
          <span>RFP X-Ray</span>
        </a>
        <div className="scope-lock"><LockKeyhole size={14} aria-hidden="true" /> Document-only. No tender search.</div>
      </header>

      <section className="workspace" id="top">
        <div className="ingest-panel">
          <p className="kicker">AUDITED TENDER ANALYSIS</p>
          <h1>Turn a tender pack into a source-linked decision brief.</h1>
          <p className="lede">Every must, scoring rule, amendment conflict, and risk. Bound to the page it came from.</p>

          <form className="source-form">
            <label htmlFor="source-url">CanadaBuys PDF URL</label>
            <div className="url-row">
              <input id="source-url" type="url" placeholder="https://canadabuys.canada.ca/.../rfp.pdf" />
              <button type="button"><FileSearch2 size={17} aria-hidden="true" /> Analyze pack</button>
            </div>
            <div className="or"><span>or</span></div>
            <label className="dropzone">
              <input type="file" accept="application/pdf,.pdf" multiple />
              <strong>Drop PDF files here</strong>
              <span>Base RFP plus up to four amendments · 25 MB each</span>
            </label>
          </form>
        </div>

        <aside className="sample-panel" aria-label="Edmonton sample result">
          <div className="sample-heading">
            <div>
              <span className="sample-label">VERIFIED SAMPLE</span>
              <h2>File Bay Repair & Maintenance</h2>
            </div>
            <span className="status">READY</span>
          </div>
          <dl className="metrics">
            <div><dt>Pages</dt><dd>55</dd></div>
            <div><dt>Mandatory gates</dt><dd>4</dd></div>
            <div><dt>Award method</dt><dd>Lowest price</dd></div>
          </dl>
          <div className="finding">
            <span className="severity">HIGH RISK</span>
            <p>Security checklist is called Annex D in one clause, but the package identifies it as Annex E.</p>
            <button type="button" className="citation">PDF p17 · View evidence</button>
          </div>
          <div className="audit-line"><span>Source cleanup</span><strong>Confirmed</strong></div>
          <div className="audit-line"><span>Critical claims cited</span><strong>12 / 12</strong></div>
        </aside>
      </section>
    </main>
  );
}
