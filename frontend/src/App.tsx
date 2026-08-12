import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import PatientsListPage from './pages/PatientsListPage'
import PatientProfilePage from './pages/PatientProfilePage'
import DoctorsPage from './pages/DoctorsPage'
import ServicesPage from './pages/ServicesPage'
import MedicationsPage from './pages/MedicationsPage'
import UsersPage from './pages/UsersPage'
import AppointmentsPage from './pages/AppointmentsPage'
import AppointmentsLogPage from './pages/AppointmentsLogPage'
import BackupPage from './pages/BackupPage'
import CashPage from './pages/CashPage'
import CommissionsPage from './pages/CommissionsPage'
import SuppliersPage from './pages/SuppliersPage'
import ItemsPage from './pages/ItemsPage'
import PurchaseInvoicesPage from './pages/PurchaseInvoicesPage'
import ChecksPage from './pages/ChecksPage'
import SettingsPage from './pages/SettingsPage'
import TelegramPage from './pages/TelegramPage'
import DashboardPage from './pages/DashboardPage'
import DebtsPage from './pages/DebtsPage'
import ReportsPage from './pages/ReportsPage'
import PrintPage from './pages/PrintPage'
import LabCasesPage from './pages/LabCasesPage'
import ActivityLogPage from './pages/ActivityLogPage'
import ChartLayoutEditorPage from './pages/ChartLayoutEditorPage'

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
            <Route path="/" element={<DashboardPage />} />
            <Route
              path="/reports"
              element={
                <ProtectedRoute permission="reports.view">
                  <ReportsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/patients"
              element={
                <ProtectedRoute permission="patients.view">
                  <PatientsListPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/patients/:id"
              element={
                <ProtectedRoute permission="patients.view">
                  <PatientProfilePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/doctors"
              element={
                <ProtectedRoute permission="doctors.view">
                  <DoctorsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/services"
              element={
                <ProtectedRoute permission="services.view">
                  <ServicesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/medications"
              element={
                <ProtectedRoute permission="medications.view">
                  <MedicationsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/users"
              element={
                <ProtectedRoute permission="users.view">
                  <UsersPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/appointments"
              element={
                <ProtectedRoute permission="appointments.view">
                  <AppointmentsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/appointments-log"
              element={
                <ProtectedRoute permission="appointments.view">
                  <AppointmentsLogPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/backups"
              element={
                <ProtectedRoute permission="settings.manage">
                  <BackupPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/cash"
              element={
                <ProtectedRoute permission="cash.view">
                  <CashPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/commissions"
              element={
                <ProtectedRoute permission="commissions.view">
                  <CommissionsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/suppliers"
              element={
                <ProtectedRoute permission="suppliers.view">
                  <SuppliersPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/items"
              element={
                <ProtectedRoute permission="inventory.view">
                  <ItemsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/purchase-invoices"
              element={
                <ProtectedRoute permission="purchasing.view">
                  <PurchaseInvoicesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/checks"
              element={
                <ProtectedRoute permission="checks.view">
                  <ChecksPage />
                </ProtectedRoute>
              }
            />
            <Route path="/debts" element={<DebtsPage />} />
            <Route path="/print" element={<PrintPage />} />
            <Route
              path="/lab-cases"
              element={
                <ProtectedRoute permission="purchasing.view">
                  <LabCasesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/activity-log"
              element={
                <ProtectedRoute role="owner">
                  <ActivityLogPage />
                </ProtectedRoute>
              }
            />
            <Route path="/settings" element={<SettingsPage />} />
            <Route
              path="/chart-layout"
              element={
                <ProtectedRoute permission="dental_chart.manage">
                  <ChartLayoutEditorPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/telegram"
              element={
                <ProtectedRoute permission="settings.manage">
                  <TelegramPage />
                </ProtectedRoute>
              }
            />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
