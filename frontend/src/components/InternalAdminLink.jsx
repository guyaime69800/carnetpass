import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

// Navigation hint only. The server still checks the live role and MFA on entry.
export default function InternalAdminLink({ className }) {
  const { session, security, securityLoading } = useAuth();
  if (securityLoading || security?.error || !session?.access_token
    || security?.token !== session.access_token
    || !['founder', 'operator'].includes(security?.role)) return null;
  return <Link className={className} to="/administration-interne">Administration interne</Link>;
}
