import Header from '@/components/Header';
import Hero from '@/components/Hero';
import Features from '@/components/Features';
import Formats from '@/components/Formats';
import CtaBanner from '@/components/CtaBanner';
import Download from '@/components/Download';
import Contacts from '@/components/Contacts';
import Footer from '@/components/Footer';

const Index = () => {
  return (
    <div className="min-h-screen bg-background font-body text-foreground">
      <Header />
      <main>
        <Hero />
        <Features />
        <Formats />
        <CtaBanner />
        <Download />
        <Contacts />
      </main>
      <Footer />
    </div>
  );
};

export default Index;
