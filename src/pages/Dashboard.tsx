import { useNavigate } from 'react-router-dom';
import { ClipboardList, HandCoins, PieChart, Shirt, TrendingUp, Landmark, BookOpen, BarChart2 } from 'lucide-react';
import { navegarAAsisport } from '../lib/navegacion';
import LogoPlaneta from '../assets/LogoPlaneta.png';

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
      <div className="flex flex-col items-center text-center mt-12 pb-8">
        <img 
          src={LogoPlaneta} 
          alt="Logo Planeta FC" 
          className="w-44 h-auto md:w-[340px] transition-transform hover:scale-105 duration-300"
        />
      </div>
    </main>
  );
};

export default Dashboard;
