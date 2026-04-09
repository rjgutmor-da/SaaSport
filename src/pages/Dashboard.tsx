import { useNavigate } from 'react-router-dom';
import { ClipboardList, HandCoins, PieChart, Shirt, TrendingUp, Settings, Landmark } from 'lucide-react';

const Dashboard = () => {
  const navigate = useNavigate();

  return (
    <main className="main-content">
      <div className="dashboard-hero-grid">
        {/* 1. AsiSport (Branding & Enlace Externo) */}
        <a 
          href="http://localhost:5173" 
          target="_blank" 
          rel="noopener noreferrer" 
          className="dashboard-hero-card hover-color-orange" 
        >
          <div className="card-icon">
            <ClipboardList size={100} strokeWidth={1.2} />
          </div>
          <span className="card-title">AsiSport</span>
        </a>

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
