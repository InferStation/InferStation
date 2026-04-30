interface Props {
  status: string;
}
export default function StatusBadge({ status }: Props) {
  const cls = status === 'online' ? 'badge badge-online' : 'badge badge-offline';
  const label =
    status === 'online' ? '在线' :
    status === 'offline' ? '离线' :
    status === 'pending' ? '待审' :
    status;
  return <span className={cls}>{label}</span>;
}
