// Some tests switch process-wide environment variables (LC_OPEN_DRYRUN, LC_NO_SYSCRED, LC_NO_GH). The whole suite takes
// about a second, so running it one test at a time costs nothing and rules out flaky interference.
[assembly: CollectionBehavior(DisableTestParallelization = true)]
