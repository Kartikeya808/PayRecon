import { LoginView } from "@/components/login-view";
import { isGoogleEnabled } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <LoginView googleEnabled={isGoogleEnabled()} />;
}
