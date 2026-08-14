import { LandingHeader } from './landing-header';
import { HeroSection } from './hero-section';
import { FeaturesSection } from './features-section';
import { TemplateShowcaseSection } from './template-showcase-section';
import { CareerJourneySection } from './career-journey-section';
import { StatsSection } from './stats-section';
import { CTASection } from './cta-section';
import { LandingFooter } from './landing-footer';

export function LandingPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <LandingHeader />
      <main id="main-content" tabIndex={-1}>
        <HeroSection />
        <FeaturesSection />
        <TemplateShowcaseSection />
        <CareerJourneySection />
        <StatsSection />
        <CTASection />
      </main>
      <LandingFooter />
    </div>
  );
}
