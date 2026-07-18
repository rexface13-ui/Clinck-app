import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import PatientsListPage from './pages/PatientsListPage'
import PatientProfilePage from './pages/PatientProfilePage'
import DoctorsPage from './pages/DoctorsPage'
import ServicesPage from './pages/ServicesPage'
import UsersPage from './pages/UsersPage'
import AppointmentsPage from './pages/AppointmentsPage'
import BackupPage from './pages/BackupPage'
import CashPage from './pages/CashPage'
import CommissionsPage from './pages/CommissionsPage'
import SuppliersPage from './pages/SuppliersPage'
import ItemsPage from './pages/ItemsPage'
import PurchaseInvoicesPage from './pages/PurchaseInvoicesPage'
import ChecksPage from './pages/ChecksPage'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<Navigate to="/patients" replace />} />
            <Route path="/patients" element={<PatientsListPage />} />
            <Route path="/patients/:id" element={<PatientProfilePage />} />
            <Route path="/doctors" element={<DoctorsPage />} />
            <Route path="/services" element={<ServicesPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/appointments" element={<AppointmentsPage />} />
            <Route path="/backups" element={<BackupPage />} />
            <Route path="/cash" element={<CashPage />} />
            <Route path="/commissions" element={<CommissionsPage />} />
            <Route path="/suppliers" element={<SuppliersPage />} />
            <Route path="/items" element={<ItemsPage />} />
            <Route path="/purchase-invoices" element={<PurchaseInvoicesPage />} />
            <Route path="/checks" element={<ChecksPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
