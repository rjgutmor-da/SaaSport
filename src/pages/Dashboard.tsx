import { useNavigate } from 'react-router-dom';
import { HandCoins, PieChart, Landmark, BookOpen, BarChart2 } from 'lucide-react';
import LogoPlaneta from '../assets/LogoPlaneta.png';
import { useAuthSaaSport } from '../lib/authHelper';

const Dashboard = () => {
  const navigate = useNavigate();
  const { escuela } = useAuthSaaSport();

  return (
    <main className="main-content">
      <div className="dashboard-hero-grid">
        {/* 1. Cuentas x Cobrar */}
        <button className="dashboard-hero-card hover-color-orange" onClick={() => navigate('/cxc')}>
          <div className="card-icon">
            <HandCoins size={100} strokeWidth={1.2} />
          </div>
          <span className="card-title">Cuentas x Cobrar</span>
        </button>

        {/* 3. Cuentas por Pagar */}
        <button className="dashboard-hero-card hover-color-green" onClick={() => navigate('/cxp')}>
          <div className="card-icon">
            <PieChart size={100} strokeWidth={1.2} />
          </div>
          <span className="card-title">Cuentas por Pagar</span>
        </button>

        {/* 4. Cajas y Bancos */}
        <button className="dashboard-hero-card hover-color-green" onClick={() => navigate('/cajas-bancos')}>
          <div className="card-icon">
            <Landmark size={100} strokeWidth={1.2} />
          </div>
          <span className="card-title">Cajas y Bancos</span>
        </button>

        {/* 5. Cuentas (Catálogo) */}
        <button className="dashboard-hero-card hover-color-blue" onClick={() => navigate('/cuentas')}>
          <div className="card-icon">
            <BookOpen size={100} strokeWidth={1.2} />
          </div>
          <span className="card-title">Cuentas</span>
        </button>

        {/* 6. Estadísticas */}
        <button className="dashboard-hero-card hover-color-purple" onClick={() => navigate('/estadisticas')}>
          <div className="card-icon">
            <BarChart2 size={100} strokeWidth={1.2} />
          </div>
          <span className="card-title">Estadísticas</span>
        </button>

      </div>

      {/* Brand Section: Logo + Phrase */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        marginTop: '3.5rem',
        paddingBottom: '2rem',
        gap: '0.75rem'
      }}>
        <img 
          src={escuela?.logo_url || LogoPlaneta} 
          alt={escuela?.nombre || "Logo Escuela"} 
          style={{
            width: '260px',
            height: 'auto',
            maxHeight: '180px',
            objectFit: 'contain',
            transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
          }}
          onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
          onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
        />
        {escuela?.slogan && (
          <p style={{
            color: 'var(--text-secondary)',
            fontStyle: 'italic',
            fontSize: '0.95rem',
            marginTop: '0.25rem',
            maxWidth: '500px',
            lineHeight: '1.4'
          }}>
            "{escuela.slogan}"
          </p>
        )}
      </div>
    </main>
  );
};

export default Dashboard;
