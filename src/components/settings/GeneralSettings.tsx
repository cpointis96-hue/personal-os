export function GeneralSettings() {
  return (
    <div style={{ paddingTop: 8 }}>
      <div style={{ marginBottom: 8, fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase" }}>
        Comportement du workspace
      </div>
      <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--color-on-dark-soft)" }}>
        Le workspace compacte automatiquement les vignettes et le contenu principal reste parcourable au scroll.
      </div>
    </div>
  );
}
