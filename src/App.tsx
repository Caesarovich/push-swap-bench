import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import "./index.css";
import Dashboard from "./Dashboard";

export function App() {
  return (
    <div className="min-h-screen w-full">
      <div className="w-full px-8 py-8">
  <Card className="p-4 bg-card border border-border backdrop-blur-sm">
          <CardHeader className="mb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-2xl font-bold">push_swap Plotter</CardTitle>
                <div className="text-sm text-muted-foreground">Run simulations and view live statistics — chart focused</div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Dashboard />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default App;
