import { useNavigate } from 'react-router-dom';
import { ClipboardList, HandCoins, PieChart, Shirt, TrendingUp, Landmark } from 'lucide-react';
import { navegarAAsisport } from '../lib/navegacion';

const Dashboard = () => {
  const navigate = useNavigate();

  return (
    <main className="main-content">
      <div className="dashboard-hero-grid">
        {/* 1. AsiSport (SSO — abre con sesión activa) */}
        <button
          className="dashboard-hero-card hover-color-orange"
          onClick={() => navegarAAsisport('/dashboard')}
          title="Abrir AsiSport con tu sesión activa"
        >
          <div className="card-icon">
            <ClipboardList size={100} strokeWidth={1.2} />
          </div>
          <span className="card-title">AsiSport</span>
        </button>

        {/* 2. Cuentas x Cobrar */}
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

        {/* 5. Inventarios */}
        <button className="dashboard-hero-card hover-color-blue" onClick={() => navigate('/inventarios')}>
          <div className="card-icon">
            <Shirt size={100} strokeWidth={1.2} />
          </div>
          <span className="card-title">Inventarios</span>
        </button>

        {/* 6. Contabilidad */}
        <button className="dashboard-hero-card hover-color-blue" onClick={() => navigate('/contabilidad')}>
          <div className="card-icon">
            <TrendingUp size={100} strokeWidth={1.2} />
          </div>
          <span className="card-title">Contabilidad</span>
        </button>
      </div>
    </main>
  );
};

export default Dashboard;
