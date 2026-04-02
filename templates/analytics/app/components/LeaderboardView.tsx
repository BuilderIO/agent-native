import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  IconTrophy,
  IconMedal,
  IconAward,
  IconSchool,
  IconBriefcase,
  IconUser,
  IconTrendingUp,
} from "@tabler/icons-react";
import { getIdToken } from "@/lib/auth";

interface LeaderboardEntry {
  userId: string;
  email: string;
  totalPoints: number;
  contributionCount: number;
  validationCount: number;
  persona: string;
  department: string;
  lastActivity: Date;
}

async function fetchLeaderboard(
  period: string,
  track: string,
): Promise<LeaderboardEntry[]> {
  const token = await getIdToken();
  const response = await fetch(
    `/api/gamification/leaderboard?period=${period}&track=${track}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
  );

  if (!response.ok) {
    throw new Error("Failed to fetch leaderboard");
  }

  const data = await response.json();
  return data.leaderboard || [];
}

async function fetchMyStats(): Promise<any> {
  const token = await getIdToken();
  const response = await fetch("/api/gamification/my-stats", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error("Failed to fetch stats");
  }

  const data = await response.json();
  return data.stats || {};
}

function PersonaBadge({ persona }: { persona: string }) {
  const config: Record<string, { icon: any; label: string; color: string }> = {
    analytics: {
      icon: IconSchool,
      label: "Analytics",
      color:
        "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30",
    },
    dept_head: {
      icon: IconBriefcase,
      label: "Dept Head",
      color:
        "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",
    },
    regular: {
      icon: IconUser,
      label: "Validator",
      color:
        "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30",
    },
  };

  const { icon: Icon, label, color } = config[persona] || config.regular;

  return (
    <Badge variant="outline" className={`${color} flex items-center gap-1`}>
      <Icon className="h-3 w-3" />
      <span>{label}</span>
    </Badge>
  );
}

function PodiumCard({ rank, user }: { rank: number; user: LeaderboardEntry }) {
  const icons = [
    { icon: IconTrophy, color: "text-yellow-500", bg: "bg-yellow-500/10" },
    { icon: IconMedal, color: "text-slate-400", bg: "bg-slate-400/10" },
    { icon: IconAward, color: "text-orange-500", bg: "bg-orange-500/10" },
  ];

  const { icon: Icon, color, bg } = icons[rank - 1];

  return (
    <Card
      className={`${bg} border-2 ${rank === 1 ? "border-yellow-500/50" : "border-border"}`}
    >
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center justify-between">
          <Icon className={`h-8 w-8 ${color}`} />
          <span className="text-2xl font-bold text-muted-foreground">
            #{rank}
          </span>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Avatar className="h-10 w-10">
              <AvatarFallback className="text-xs">
                {user.email.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="font-semibold truncate text-sm">{user.email}</p>
              <PersonaBadge persona={user.persona} />
            </div>
          </div>

          <div className="pt-2 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Points</span>
              <span className="text-lg font-bold text-primary">
                {user.totalPoints}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Contributions</span>
              <span className="font-medium">{user.contributionCount}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Validations</span>
              <span className="font-medium">{user.validationCount}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function LeaderboardView() {
  const [period, setPeriod] = useState<"week" | "month" | "alltime">("week");
  const [track, setTrack] = useState<"all" | "contributors" | "validators">(
    "all",
  );

  const { data: leaderboard = [], isLoading } = useQuery({
    queryKey: ["leaderboard", period, track],
    queryFn: () => fetchLeaderboard(period, track),
    staleTime: 30 * 1000, // 30 seconds
  });

  const { data: myStats } = useQuery({
    queryKey: ["my-stats"],
    queryFn: fetchMyStats,
    staleTime: 30 * 1000,
  });

  const topThree = leaderboard.slice(0, 3);
  const rest = leaderboard.slice(3);

  return (
    <div className="space-y-6">
      {/* My Stats Banner */}
      {myStats && (
        <Card className="bg-gradient-to-r from-primary/10 to-primary/5 border-primary/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Your Stats</p>
                <div className="flex items-center gap-4">
                  <div>
                    <p className="text-3xl font-bold text-primary">
                      {myStats.totalPoints}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Total Points
                    </p>
                  </div>
                  {myStats.rank && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <IconTrendingUp className="h-4 w-4" />
                      <span className="text-sm">Rank #{myStats.rank}</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 text-right">
                <div>
                  <p className="text-2xl font-semibold">
                    {myStats.contributionCount}
                  </p>
                  <p className="text-xs text-muted-foreground">Contributions</p>
                </div>
                <div>
                  <p className="text-2xl font-semibold">
                    {myStats.validationCount}
                  </p>
                  <p className="text-xs text-muted-foreground">Validations</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Period & Track Selectors */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <Tabs value={period} onValueChange={(v) => setPeriod(v as any)}>
          <TabsList>
            <TabsTrigger value="week">This Week</TabsTrigger>
            <TabsTrigger value="month">This Month</TabsTrigger>
            <TabsTrigger value="alltime">All Time</TabsTrigger>
          </TabsList>
        </Tabs>

        <Tabs value={track} onValueChange={(v) => setTrack(v as any)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="contributors">Contributors</TabsTrigger>
            <TabsTrigger value="validators">Validators</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isLoading && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-64 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        </div>
      )}

      {!isLoading && leaderboard.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-center py-12">
            <p className="text-sm text-muted-foreground">
              No leaderboard data yet. Start contributing to see rankings!
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && topThree.length > 0 && (
        <>
          {/* Top 3 Podium */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {topThree.map((user, index) => (
              <PodiumCard key={user.userId} rank={index + 1} user={user} />
            ))}
          </div>

          {/* Full Leaderboard Table */}
          {rest.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Full Rankings</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Rank</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Persona</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead className="text-right">Points</TableHead>
                      <TableHead className="text-right">
                        Contributions
                      </TableHead>
                      <TableHead className="text-right">Validations</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rest.map((user, index) => (
                      <TableRow key={user.userId}>
                        <TableCell className="font-medium text-muted-foreground">
                          #{index + 4}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Avatar className="h-8 w-8">
                              <AvatarFallback className="text-xs">
                                {user.email.slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <span className="font-medium text-sm">
                              {user.email}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <PersonaBadge persona={user.persona} />
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {user.department}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {user.totalPoints}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {user.contributionCount}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {user.validationCount}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
