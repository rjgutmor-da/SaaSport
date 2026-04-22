import { useNavigate } from 'react-router-dom';
import { ClipboardList, HandCoins, PieChart, Shirt, TrendingUp, Landmark } from 'lucide-react';
import { navegarAAsisport } from '../lib/navegacion';

const Dashboard = () => {
  const navigate = useNavigate();

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

      </div>
    </main>
  );
};

export default Dashboard;
