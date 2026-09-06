import { isRouteErrorResponse, useRouteError } from 'react-router'
import { AlertCircle, ArrowLeft, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function RouteErrorPage() {
  const error = useRouteError()
  let errorMessage = 'An unexpected error occurred.'
  let errorDetails = ''

  if (isRouteErrorResponse(error)) {
    errorMessage = `${error.status} ${error.statusText}`
    errorDetails = typeof error.data === 'string' ? error.data : JSON.stringify(error.data)
  } else if (error instanceof Error) {
    errorMessage = error.message
    errorDetails = error.stack ?? ''
  } else if (typeof error === 'string') {
    errorMessage = error
  }

  const isModuleFetchError =
    errorMessage.toLowerCase().includes('failed to fetch dynamically imported module') ||
    errorMessage.toLowerCase().includes('importing a module script failed')

  const handleReload = () => {
    window.location.reload()
  }

  const handleGoHome = () => {
    window.location.href = '/'
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center p-4 bg-background text-foreground">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl backdrop-blur">
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertCircle className="h-8 w-8" />
          </div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            {isModuleFetchError ? 'New Version Available' : 'Something Went Wrong'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {isModuleFetchError
              ? 'A new version of the app was deployed, or your connection dropped. Reloading the page will load the latest app modules.'
              : 'The application encountered an error while loading this route.'}
          </p>
        </div>

        <div className="my-6 rounded-lg bg-muted/60 p-3.5 text-xs font-mono break-all text-muted-foreground">
          <p className="font-semibold text-foreground/80 mb-1">{errorMessage}</p>
          {errorDetails && (
            <details className="mt-2 cursor-pointer">
              <summary className="text-[11px] text-muted-foreground hover:text-foreground">Show stack trace</summary>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[10px] leading-tight text-muted-foreground/80">
                {errorDetails}
              </pre>
            </details>
          )}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={handleGoHome} className="w-full sm:w-auto gap-2">
            <ArrowLeft className="h-4 w-4" />
            Home / Library
          </Button>
          <Button onClick={handleReload} className="w-full sm:w-auto gap-2">
            <RefreshCw className="h-4 w-4" />
            Reload Page
          </Button>
        </div>
      </div>
    </div>
  )
}
