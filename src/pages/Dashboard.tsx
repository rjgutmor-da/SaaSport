import { useNavigate } from 'react-router-dom';
import { ClipboardList, HandCoins, PieChart, Shirt, TrendingUp, Settings, Landmark } from 'lucide-react';

const Dashboard = () => {
  const navigate = useNavigate();

  return (
    <main className="main-content">
      <div className="dashboard-hero-grid">
        {/* AsiSport (Branding & Enlace Externo) */}
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

        {/* Cuentas x Cobrar */}
        <button className="dashboard-hero-card hover-color-green" onClick={() => navigate('/cxc')}>
          <div className="card-icon">
            <HandCoins size={100} strokeWidth={1.2} />
          </div>
          <span className="card-title">Cuentas x Cobrar</span>
        </button>

        {/* Cuentas x Pagar */}
        <button className="dashboard-hero-card hover-color-orange" onClick={() => navigate('/cxp')}>
          <div className="card-icon">
            <PieChart size={100} strokeWidth={1.2} />
          </div>
          <span className="card-title">Cuentas x Pagar</span>
        </button>

        {/* Inventarios */}
        <button className="dashboard-hero-card hover-color-blue" onClick={() => navigate('/inventarios')}>
          <div className="card-icon">
            <Shirt size={100} strokeWidth={1.2} />
          </div>
          <span className="card-title">Inventarios</span>
        </button>

        {/* Finanzas */}
        <button className="dashboard-hero-card hover-color-green" onClick={() => navigate('/finanzas')}>
          <div className="card-icon">
            <TrendingUp size={100} strokeWidth={1.2} />
          </div>
          <span className="card-title">Finanzas</span>
        </button>

        {/* Cajas y Bancos */}
        <button className="dashboard-hero-card hover-color-blue" onClick={() => navigate('/cajas-bancos')}>
          <div className="card-icon">
            <Landmark size={100} strokeWidth={1.2} />
          </div>
          <span className="card-title">Cajas y Bancos</span>
        </button>
      </div>
    </main>
  );
};

export default Dashboard;
