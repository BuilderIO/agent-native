import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import {
  TrendingUp,
  Utensils,
  Dumbbell,
  ArrowRight,
  CheckCircle2,
  Zap,
  Shield,
  Smartphone,
  Brain,
  Target,
} from "lucide-react";

export default function Landing() {
  return (
    <div className="min-h-screen relative overflow-hidden bg-background selection:bg-primary/20">
      {/* Background Gradients */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-primary/5 blur-[120px]" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/60 backdrop-blur-xl border-b border-border/10 px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Logo className="text-xl" />
          <div className="flex items-center gap-3">
            <Link to="/login">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
              >
                Sign in
              </Button>
            </Link>
            <Link to="/signup">
              <Button
                size="sm"
                className="bg-foreground text-background hover:bg-foreground/90"
              >
                Get started
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        {/* Hero Section */}
        <section className="max-w-5xl mx-auto px-4 pt-24 pb-32 text-center">
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.03] border border-white/[0.08] mb-8">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              <span className="text-xs font-medium text-muted-foreground">
                AI-Powered Nutrition Tracking
              </span>
            </div>

            <h1 className="text-5xl sm:text-7xl font-bold tracking-tight mb-6">
              <span className="bg-clip-text text-transparent bg-gradient-to-b from-foreground to-foreground/60">
                Eat smarter.
              </span>
              <br />
              <span className="bg-clip-text text-transparent bg-gradient-to-b from-foreground/60 to-foreground/30">
                Live better.
              </span>
            </h1>

            <p className="text-lg sm:text-xl text-muted-foreground max-w-xl mx-auto mb-10 leading-relaxed">
              Effortlessly track your meals and exercise with our intelligent
              calorie estimator. Reach your goals without the hassle of manual
              entry.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link to="/signup" className="w-full sm:w-auto">
                <Button
                  size="lg"
                  className="w-full sm:w-auto h-12 px-8 text-base gap-2 bg-foreground text-background hover:bg-foreground/90"
                >
                  Start tracking free <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link to="/login" className="w-full sm:w-auto">
                <Button
                  variant="outline"
                  size="lg"
                  className="w-full sm:w-auto h-12 px-8 text-base bg-transparent border-white/10 hover:bg-white/5"
                >
                  Sign in
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* App Preview / Stats */}
        <section className="max-w-5xl mx-auto px-4 pb-32">
          <div className="grid md:grid-cols-3 gap-8 animate-in fade-in slide-in-from-bottom-8 duration-1000 delay-200">
            <div className="p-8 rounded-2xl bg-gradient-to-b from-white/[0.04] to-transparent border border-white/[0.06] hover:border-white/[0.1] transition-colors group">
              <div className="h-12 w-12 rounded-xl bg-blue-500/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                <Utensils className="h-6 w-6 text-blue-400" />
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-3">
                Smart Logging
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                Just type what you ate. Our AI instantly estimates calories and
                macros for you.
              </p>
            </div>

            <div className="p-8 rounded-2xl bg-gradient-to-b from-white/[0.04] to-transparent border border-white/[0.06] hover:border-white/[0.1] transition-colors group">
              <div className="h-12 w-12 rounded-xl bg-orange-500/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                <Dumbbell className="h-6 w-6 text-orange-400" />
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-3">
                Activity Tracking
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                Log your workouts to see how they impact your daily net calorie
                balance.
              </p>
            </div>

            <div className="p-8 rounded-2xl bg-gradient-to-b from-white/[0.04] to-transparent border border-white/[0.06] hover:border-white/[0.1] transition-colors group">
              <div className="h-12 w-12 rounded-xl bg-green-500/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                <TrendingUp className="h-6 w-6 text-green-400" />
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-3">
                Progress Insights
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                Visualize your journey with beautiful charts and daily progress
                summaries.
              </p>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="py-24 border-y border-white/[0.04] bg-white/[0.01]">
          <div className="max-w-5xl mx-auto px-4">
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold tracking-tight mb-4">
                How it works
              </h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                We've simplified nutrition tracking down to the essentials. No
                complex forms, no confusing databases.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-12 items-center">
              <div className="space-y-8">
                <div className="flex gap-4">
                  <div className="h-10 w-10 shrink-0 rounded-full bg-white/[0.05] flex items-center justify-center border border-white/[0.1]">
                    <span className="font-mono font-bold">1</span>
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold mb-2">
                      Log your meals
                    </h3>
                    <p className="text-muted-foreground">
                      Simply type "Chicken salad with avocado" and let our AI
                      handle the rest. We calculate calories, protein, carbs,
                      and fats automatically.
                    </p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="h-10 w-10 shrink-0 rounded-full bg-white/[0.05] flex items-center justify-center border border-white/[0.1]">
                    <span className="font-mono font-bold">2</span>
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold mb-2">
                      Track your movement
                    </h3>
                    <p className="text-muted-foreground">
                      Add your exercises to see your net calorie balance. We
                      support everything from running to weightlifting.
                    </p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="h-10 w-10 shrink-0 rounded-full bg-white/[0.05] flex items-center justify-center border border-white/[0.1]">
                    <span className="font-mono font-bold">3</span>
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold mb-2">
                      Hit your goals
                    </h3>
                    <p className="text-muted-foreground">
                      Watch your daily progress bar fill up. Stay consistent and
                      reach your health goals faster.
                    </p>
                  </div>
                </div>
              </div>

              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/20 to-purple-500/20 blur-3xl rounded-full opacity-30" />
                <div className="relative rounded-xl border border-white/[0.1] bg-black/40 backdrop-blur-xl p-6 shadow-2xl">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between border-b border-white/[0.1] pb-4">
                      <div className="space-y-1">
                        <div className="h-2 w-24 bg-white/20 rounded" />
                        <div className="h-2 w-16 bg-white/10 rounded" />
                      </div>
                      <div className="h-8 w-8 rounded-full bg-white/10" />
                    </div>
                    <div className="space-y-2">
                      <div className="h-12 rounded-lg bg-white/[0.05] w-full" />
                      <div className="h-12 rounded-lg bg-white/[0.05] w-full" />
                      <div className="h-12 rounded-lg bg-white/[0.05] w-full" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features Grid */}
        <section className="py-24 max-w-5xl mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight mb-4">
              Everything you need
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Powerful features to help you stay on track, without the clutter.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: Zap,
                title: "Lightning Fast",
                desc: "Built for speed. Log meals in seconds, not minutes.",
              },
              {
                icon: Brain,
                title: "AI Intelligence",
                desc: "Smart estimation for complex meals and recipes.",
              },
              {
                icon: Target,
                title: "Goal Setting",
                desc: "Customizable calorie and macro goals to fit your needs.",
              },
              {
                icon: Smartphone,
                title: "Mobile First",
                desc: "Works perfectly on your phone, tablet, or desktop.",
              },
              {
                icon: Shield,
                title: "Private & Secure",
                desc: "Your data is encrypted and never shared with third parties.",
              },
              {
                icon: TrendingUp,
                title: "Analytics",
                desc: "Deep insights into your nutrition trends over time.",
              },
            ].map((feature, i) => (
              <div
                key={i}
                className="p-6 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
              >
                <feature.icon className="h-6 w-6 text-foreground/70 mb-4" />
                <h3 className="font-semibold text-foreground mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-muted-foreground">{feature.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="py-24 border-t border-white/[0.04]">
          <div className="max-w-3xl mx-auto px-4 text-center">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-6">
              Ready to transform your health?
            </h2>
            <p className="text-lg text-muted-foreground mb-10">
              Join thousands of users who are already tracking their nutrition
              the smart way.
            </p>
            <Link to="/signup">
              <Button
                size="lg"
                className="h-12 px-8 text-base gap-2 bg-foreground text-background hover:bg-foreground/90"
              >
                Get started for free <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="py-12 border-t border-white/[0.04] bg-white/[0.01]">
        <div className="max-w-5xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-6 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Logo className="text-lg" />
            <span className="text-muted-foreground/30">|</span>
            <span>© {new Date().getFullYear()} NutriTrack</span>
          </div>
          <div className="flex gap-8">
            <Link
              to="/login"
              className="hover:text-foreground transition-colors"
            >
              Sign in
            </Link>
            <Link
              to="/signup"
              className="hover:text-foreground transition-colors"
            >
              Get started
            </Link>
            <a href="#" className="hover:text-foreground transition-colors">
              Privacy
            </a>
            <a href="#" className="hover:text-foreground transition-colors">
              Terms
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
