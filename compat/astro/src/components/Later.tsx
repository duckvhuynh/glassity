/**
 * An island that hydrates only when scrolled into view. Until then its markup is
 * server HTML that React has yet to claim: glassity must leave it alone, or React
 * finds a canvas it did not render when it finally hydrates.
 */
export default function Later() {
  return (
    <div className="stage">
      <svg data-glass id="later" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
        <circle cx="12" cy="12" r="8" />
      </svg>
    </div>
  );
}
