import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import { RequirePermissions } from '../common/decorators/auth.decorators';
import { ApiZodBody, ApiZodQuery, zv } from '../common/pipes/zod.pipe';
import { ValidationError } from '../common/errors/app-error';
import {
  faqSourceSchema,
  KnowledgeService,
  listSourcesSchema,
  MAX_UPLOAD_BYTES,
  textSourceSchema,
  updateSourceSchema,
  urlSourceSchema,
  websiteImportSchema,
} from './knowledge.service';

const searchSchema = z.object({ q: z.string().trim().min(2).max(500), topK: z.coerce.number().int().min(1).max(10).default(4) });
const uploadMetaSchema = z.object({ title: z.string().trim().max(200).optional(), category: z.string().trim().max(60).optional() });

@ApiTags('Knowledge')
@ApiBearerAuth()
@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get('documents')
  @RequirePermissions('knowledge.read')
  @ApiZodQuery(listSourcesSchema)
  list(@Query(zv(listSourcesSchema)) q: z.infer<typeof listSourcesSchema>) {
    return this.knowledge.list(q);
  }

  @Get('stats')
  @RequirePermissions('knowledge.read')
  stats() {
    return this.knowledge.stats();
  }

  @Get('search')
  @RequirePermissions('knowledge.read')
  @ApiZodQuery(searchSchema)
  search(@Query(zv(searchSchema)) q: z.infer<typeof searchSchema>) {
    return this.knowledge.search(q.q, { topK: q.topK });
  }

  @Get('documents/:id')
  @RequirePermissions('knowledge.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.knowledge.get(id);
  }

  @Post('documents')
  @RequirePermissions('knowledge.write')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, title: { type: 'string' }, category: { type: 'string' } } } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  upload(@UploadedFile() file: Express.Multer.File | undefined, @Body(zv(uploadMetaSchema)) meta: z.infer<typeof uploadMetaSchema>) {
    if (!file) throw new ValidationError('A file is required (field "file")');
    return this.knowledge.createFromFile(file, meta);
  }

  @Post('text')
  @RequirePermissions('knowledge.write')
  @ApiZodBody(textSourceSchema)
  text(@Body(zv(textSourceSchema)) dto: z.infer<typeof textSourceSchema>) {
    return this.knowledge.createFromText(dto);
  }

  @Post('faq')
  @RequirePermissions('knowledge.write')
  @ApiZodBody(faqSourceSchema)
  faq(@Body(zv(faqSourceSchema)) dto: z.infer<typeof faqSourceSchema>) {
    return this.knowledge.createFaq(dto);
  }

  @Post('website')
  @RequirePermissions('knowledge.write')
  @ApiZodBody(websiteImportSchema)
  website(@Body(zv(websiteImportSchema)) dto: z.infer<typeof websiteImportSchema>) {
    return this.knowledge.importWebsite(dto);
  }

  @Post('url')
  @RequirePermissions('knowledge.write')
  @ApiZodBody(urlSourceSchema)
  url(@Body(zv(urlSourceSchema)) dto: z.infer<typeof urlSourceSchema>) {
    return this.knowledge.createFromUrl(dto);
  }

  @Patch('documents/:id')
  @RequirePermissions('knowledge.write')
  @ApiZodBody(updateSourceSchema)
  update(@Param('id', ParseUUIDPipe) id: string, @Body(zv(updateSourceSchema)) dto: z.infer<typeof updateSourceSchema>) {
    return this.knowledge.update(id, dto);
  }

  @Post('documents/:id/reprocess')
  @RequirePermissions('knowledge.write')
  reprocess(@Param('id', ParseUUIDPipe) id: string) {
    return this.knowledge.reprocess(id);
  }

  @Delete('documents/:id')
  @RequirePermissions('knowledge.write')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.knowledge.remove(id);
  }
}
