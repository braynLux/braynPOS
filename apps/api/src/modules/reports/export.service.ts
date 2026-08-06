import { google } from 'googleapis'
import { googleService } from '../settings/google.service.js'

export class ExportService {
  
  /**
   * Generates a Google Sheet with tabular data.
   */
  async exportToSheets(userId: string, title: string, data: any[], headers: string[]) {
    const authClient = await googleService.getAuthenticatedClient(userId)
    const sheets = google.sheets({ version: 'v4', auth: authClient })

    // Create the spreadsheet
    const spreadsheet = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: `${title} - ${new Date().toISOString().split('T')[0]}` },
      },
    })

    const spreadsheetId = spreadsheet.data.spreadsheetId!

    // Prepare data
    const rows = [headers, ...data]

    // Write data to sheet
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Sheet1!A1',
      valueInputOption: 'RAW',
      requestBody: { values: rows },
    })

    // Format headers (bold) and auto-resize columns
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
              cell: { userEnteredFormat: { textFormat: { bold: true } } },
              fields: 'userEnteredFormat.textFormat.bold',
            },
          },
          {
            autoResizeDimensions: {
              dimensions: { sheetId: 0, dimension: 'COLUMNS', startIndex: 0, endIndex: headers.length },
            },
          },
        ],
      },
    })

    return { url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` }
  }

  /**
   * Generates a Google Doc with simple tabular data.
   */
  async exportToDocs(userId: string, title: string, data: any[], headers: string[]) {
    const authClient = await googleService.getAuthenticatedClient(userId)
    const docs = google.docs({ version: 'v1', auth: authClient })

    // Create document
    const document = await docs.documents.create({
      requestBody: { title: `${title} - ${new Date().toISOString().split('T')[0]}` },
    })

    const documentId = document.data.documentId!

    // Flatten data for docs table insertion
    const tableCells = []
    
    // Header cells
    headers.forEach(h => {
      tableCells.push({ text: String(h), bold: true })
    })

    // Data cells
    data.forEach(row => {
      headers.forEach((_, i) => {
        tableCells.push({ text: String(row[i] ?? ''), bold: false })
      })
    })

    // Insert title and standard table request
    // This is a simplified approach to push data. 
    // Docs API is complex, so we just write the text block or basic layout.
    let textToInsert = `${title}\nCompleted At: ${new Date().toLocaleString()}\n\n`
    textToInsert += headers.join(' | ') + '\n'
    textToInsert += '-'.repeat(80) + '\n'
    
    data.forEach(row => {
      textToInsert += row.map((c: any) => String(c)).join(' | ') + '\n'
    })

    await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          { insertText: { location: { index: 1 }, text: textToInsert } }
        ]
      }
    })

    return { url: `https://docs.google.com/document/d/${documentId}/edit` }
  }
}

export const exportService = new ExportService()
