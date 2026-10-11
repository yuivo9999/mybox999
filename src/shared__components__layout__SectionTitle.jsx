export function SectionTitle({ title, action, onAction }) {
  return <div className="section-title"><h3>{title}</h3>{action && <button onClick={onAction}>{action}</button>}</div>;
}
