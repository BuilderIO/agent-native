import { useT } from "@agent-native/core/client";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@agent-native/toolkit/ui/avatar";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@agent-native/toolkit/ui/card";

const activities = [
  {
    name: "Olivia Martin", // i18n-ignore stable sample person name
    email: "olivia.martin@email.com",
    amount: "+$1,999.00",
    avatar: "/avatars/01.png",
    initials: "OM",
  },
  {
    name: "Jackson Lee", // i18n-ignore stable sample person name
    email: "jackson.lee@email.com",
    amount: "+$39.00",
    avatar: "/avatars/02.png",
    initials: "JL",
  },
  {
    name: "Isabella Nguyen", // i18n-ignore stable sample person name
    email: "isabella.nguyen@email.com",
    amount: "+$299.00",
    avatar: "/avatars/03.png",
    initials: "IN",
  },
  {
    name: "William Kim", // i18n-ignore stable sample person name
    email: "will@email.com",
    amount: "+$99.00",
    avatar: "/avatars/04.png",
    initials: "WK",
  },
  {
    name: "Sofia Davis", // i18n-ignore stable sample person name
    email: "sofia.davis@email.com",
    amount: "+$39.00",
    avatar: "/avatars/05.png",
    initials: "SD",
  },
];

export function RecentActivity() {
  const t = useT();

  return (
    <Card className="col-span-full lg:col-span-3 bg-card border-border/50">
      <CardHeader>
        <CardTitle>{t("dashboard.recentSales")}</CardTitle>
        <CardDescription>
          {t("dashboard.recentSalesDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-8">
          {activities.map((activity, index) => (
            <div key={index} className="flex items-center">
              <Avatar className="h-9 w-9">
                <AvatarImage src={activity.avatar} alt="Avatar" />
                <AvatarFallback>{activity.initials}</AvatarFallback>
              </Avatar>
              <div className="ml-4 space-y-1">
                <p className="text-sm font-medium leading-none">
                  {activity.name}
                </p>
                <p className="text-sm text-muted-foreground">
                  {activity.email}
                </p>
              </div>
              <div className="ml-auto font-medium">{activity.amount}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
