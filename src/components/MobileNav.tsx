import { NavLink, useLocation } from 'react-router-dom';
import { HandCoins, PieChart, Landmark } from 'lucide-react';

const tabs = [
  { to: '/cxc',          icon: HandCoins, label: 'CXC' },
  { to: '/cxp',          icon: PieChart,  label: 'CxP' },
  { to: '/cajas-bancos', icon: Landmark,  label: 'Cajas' },
] as const;

export function MobileNav() {
  const location = useLocation();

  return (
    <nav
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        height: '64px',
        display: 'flex',
        borderTop: '1px solid var(--border)',
        backgroundColor: 'var(--bg-card)',
        paddingBottom: 'env(safe-area-inset-bottom)', // soporte para notch en iPhone
      }}
    >
      {tabs.map(({ to, icon: Icon, label }) => {
        const isActive = (to as string) === '/'
          ? location.pathname === '/'
          : location.pathname.startsWith(to);

        return (
          <NavLink
            key={to}
            to={to}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              fontSize: '11px',
              fontWeight: isActive ? 700 : 400,
              textDecoration: 'none',
              color: isActive
                ? 'var(--primary)'
                : 'var(--text-secondary)',
              transition: 'all 0.2s ease',
            }}
          >
            <Icon
              size={22}
              strokeWidth={isActive ? 2.5 : 1.5}
            />
            {label}
          </NavLink>
        );
      })}
    </nav>
  );
}
