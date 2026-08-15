type Props = {
  artKey: string;
  title: string;
  compact?: boolean;
};

const numbers: Record<string, string> = { life: "01", office: "02", knock: "03" };

export default function ThemePosterArt({ artKey, title, compact = false }: Props) {
  return (
    <span className={`theme-poster-art ${artKey} ${compact ? "compact" : ""}`} aria-hidden="true">
      <span className="theme-poster-number">{numbers[artKey] || "·"}</span>
      <i className="theme-poster-orbit" />
      <i className="theme-poster-axis" />
      <strong>{title}</strong>
      <small>카타르시스 이스케이프</small>
    </span>
  );
}
