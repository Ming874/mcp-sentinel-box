import { Header } from './components/Header'
import { Hero } from './components/Hero'
import { Problem } from './components/Problem'
import { Architecture } from './components/Architecture'
import { Lifecycle } from './components/Lifecycle'
import { Decisions } from './components/Decisions'
import { Defense } from './components/Defense'
import { Telemetry } from './components/Telemetry'
import { Mcp } from './components/Mcp'
import { Rationale } from './components/Rationale'
import { GetStarted } from './components/GetStarted'
import { Footer } from './components/Footer'

export default function App() {
  return (
    <>
      <Header />
      <main id="main">
        <Hero />
        <Problem />
        <div className="border-y border-line bg-surface/40">
          <Architecture />
        </div>
        <Lifecycle />
        <div className="border-y border-line bg-surface/40">
          <Decisions />
        </div>
        <Defense />
        <div className="border-y border-line bg-surface/40">
          <Telemetry />
        </div>
        <Mcp />
        <div className="border-y border-line bg-surface/40">
          <Rationale />
        </div>
        <GetStarted />
      </main>
      <Footer />
    </>
  )
}
